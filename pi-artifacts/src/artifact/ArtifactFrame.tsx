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

    // The page's runtime says hello as it starts. The first hello from this frame gets the
    // bridge; anything later (a reload, or a page the artifact navigated to) gets nothing.
    // Waiting for the page to ask, rather than counting load events, means an about:blank
    // or an earlier navigation can never take the port.
    let connected = false;
    const onMessage = (event: MessageEvent) => {
      if (connected || event.source !== iframe.contentWindow || event.data?.type !== "pi:hello") return;
      connected = true;
      const channel = new MessageChannel();
      broker.connect(channel.port1);
      (event.source as Window).postMessage({ type: "pi:connect", manifest }, "*", [channel.port2]);
    };
    const onVisibility = () => broker.setHidden(document.visibilityState === "hidden");

    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    // Each version gets its own frame (see ArtifactPanel's key), so this only skips the
    // second run of a development-mode double effect.
    const url = `/u/${artifactId}/v${version}`;
    if (iframe.getAttribute("src") !== url) iframe.src = url;
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      broker.close();
    };
    // The manifest is fixed per version, so the version stands for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactId, version, uid]);

  return <iframe ref={ref} className="artifact-frame" title={title} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" />;
}
