import { useEffect, useRef } from "react";
import type { ArtifactManifest } from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { ArtifactBroker } from "./broker.ts";

interface Props {
  artifactId: string;
  version: number;
  manifest: ArtifactManifest;
  /** The signed-in viewer, or undefined; keys the browser cache. */
  uid: string | undefined;
  title: string;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The artifact in a sandboxed iframe (opaque origin, no network of its own)
 * plus the broker that answers its runtime over a MessagePort.
 */
export function ArtifactFrame({ artifactId, version, manifest, uid, title }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current!;
    const broker = new ArtifactBroker({
      artifactId,
      version,
      transport: (call) => api.proxy(artifactId, call),
      describe: () => api.artifactTools(artifactId, version),
      cacheNamespace: uid ?? "anonymous",
      storage: browserStorage(),
    });

    // The bridge goes to the first document only. If the page navigates
    // itself elsewhere, whatever loads next gets no port.
    let loads = 0;
    const onLoad = () => {
      if (++loads > 1) return;
      const channel = new MessageChannel();
      broker.connect(channel.port1);
      iframe.contentWindow?.postMessage({ type: "pi:connect", manifest }, "*", [channel.port2]);
    };
    const onVisibility = () => broker.setHidden(document.visibilityState === "hidden");

    iframe.addEventListener("load", onLoad);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    iframe.src = `/u/${artifactId}/v${version}`;
    return () => {
      iframe.removeEventListener("load", onLoad);
      document.removeEventListener("visibilitychange", onVisibility);
      broker.close();
      iframe.src = "about:blank";
    };
    // The manifest is fixed per version, so the version stands for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactId, version, uid]);

  return <iframe ref={ref} className="artifact-frame" title={title} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" />;
}
