import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { ChatSummary } from "../shared/protocol.ts";
import { api, type ArtifactSummary, type FileInfo, type Me } from "./api.ts";
import { ArtifactPanel } from "./artifact/ArtifactPanel.tsx";
import { ChatView, type PublishedArtifact } from "./chat/ChatView.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { ResizeHandle, useStoredState } from "./layout.tsx";

function usePath(): [string, (path: string) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((next: string) => {
    if (next !== location.pathname) history.pushState(null, "", next);
    setPath(next);
  }, []);
  return [path, navigate];
}

export function App() {
  const [path, navigate] = usePath();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [auth, setAuth] = useState<Me["auth"]>("access");

  useEffect(() => {
    api.me().then(
      (result) => {
        setAuth(result.auth);
        setMe(result.me);
      },
      () => setMe(null),
    );
  }, []);

  if (me === undefined) return null;
  // Deployed, Cloudflare Access signs people in before the app loads; a 401 here means the session lapsed.
  if (me === null && auth === "access") return <AccessExpired />;
  if (me === null) return <SignIn onSignedIn={(uid) => setMe({ uid, auth: "demo" })} />;

  const shared = path.match(/^\/a\/([a-z0-9]+)$/);
  if (shared) {
    // A shared artifact: anyone the app lets in can view it by its link.
    return (
      <ErrorBoundary what="this artifact">
        <ArtifactPanel artifactId={shared[1]} uid={me.uid} fullPage />
      </ErrorBoundary>
    );
  }

  const chatId = path.match(/^\/c\/([a-z0-9]+)$/)?.[1];
  return (
    <Workspace
      uid={me.uid}
      label={me.email ?? me.uid}
      chatId={chatId}
      navigate={navigate}
      onSignOut={async () => {
        if (me.auth === "access") {
          location.href = "/cdn-cgi/access/logout";
          return;
        }
        await api.signOut();
        setMe(null);
        navigate("/");
      }}
    />
  );
}

function AccessExpired() {
  return (
    <main className="sign-in">
      <div>
        <h1>pi-artifacts</h1>
        <p>Your sign-in has expired.</p>
        <button type="button" className="primary" onClick={() => location.reload()}>
          Sign in again
        </button>
      </div>
    </main>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (uid: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      onSignedIn((await api.signIn(name)).uid);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <main className="sign-in">
      <form onSubmit={submit}>
        <h1>pi-artifacts</h1>
        <p>Chat with a Pi agent that builds live dashboards from MCP data.</p>
        <label>
          Your name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ada" />
        </label>
        <button type="submit" disabled={!name.trim()}>
          Continue
        </button>
        {error && <p className="form-error">{error}</p>}
        <p className="hint">Demo sign-in: no password, so anyone who types the same name sees the same chats.</p>
      </form>
    </main>
  );
}

interface WorkspaceProps {
  uid: string;
  /** What the sidebar shows for the signed-in user: their email, or the demo name. */
  label: string;
  chatId: string | undefined;
  navigate: (path: string) => void;
  onSignOut: () => void;
}

const SIDEBAR_DEFAULT = 240;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const RAIL_WIDTH = 52;
const CHAT_MIN = 320;
const PREVIEW_MIN = 360;

function Workspace({ uid, label, chatId, navigate, onSignOut }: WorkspaceProps) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [preview, setPreview] = useState<PublishedArtifact | null>(null);
  const [collapsed, setCollapsed] = useStoredState("layout.sidebarCollapsed", false);
  const [sidebarWidth, setSidebarWidth] = useStoredState("layout.sidebarWidth", SIDEBAR_DEFAULT);
  // The chat column's width beside an open preview; null splits the space 40/60.
  const [chatWidth, setChatWidth] = useStoredState<number | null>("layout.chatWidth", null);
  const chatRef = useRef<HTMLElement>(null);

  const refresh = useCallback(() => {
    api.chats().then(setChats, () => {});
    api.artifacts().then(setArtifacts, () => {});
    api.files().then(setFiles, () => {});
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => setPreview(null), [chatId]);

  const newChat = async () => {
    const chat = await api.createChat();
    refresh();
    navigate(`/c/${chat.id}`);
  };

  const onArtifact = useCallback(
    (artifact: PublishedArtifact) => {
      setPreview(artifact);
      refresh();
    },
    [refresh],
  );

  const upload = async (file: File | undefined) => {
    if (!file) return;
    await api.upload(file);
    refresh();
  };

  return (
    <div
      className={["workspace", preview && "with-preview", collapsed && "collapsed"].filter(Boolean).join(" ")}
      style={
        {
          "--sidebar-w": `${collapsed ? RAIL_WIDTH : sidebarWidth}px`,
          "--chat-w": chatWidth === null ? "40%" : `${chatWidth}px`,
        } as CSSProperties
      }
    >
      {collapsed ? (
        <aside className="sidebar rail">
          <button type="button" onClick={() => setCollapsed(false)} title="Show the sidebar" aria-label="Show the sidebar">
            »
          </button>
          <button type="button" className="primary" onClick={newChat} title="New chat" aria-label="New chat">
            +
          </button>
        </aside>
      ) : (
        <aside className="sidebar">
          <div className="sidebar-top">
            <button type="button" className="primary" onClick={newChat}>
              + New chat
            </button>
            <button type="button" onClick={() => setCollapsed(true)} title="Hide the sidebar" aria-label="Hide the sidebar">
              «
            </button>
          </div>
          <h3>Chats</h3>
          <nav>
            {chats.map((chat) => (
              <a
                key={chat.id}
                href={`/c/${chat.id}`}
                className={chat.id === chatId ? "active" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/c/${chat.id}`);
                }}
              >
                {chat.title}
              </a>
            ))}
          </nav>
          <h3>Artifacts</h3>
          <nav>
            {artifacts.map((a) => (
              <a key={a.id} href={`/a/${a.id}`} target="_blank" rel="noreferrer">
                {a.title} <small>v{a.latest}</small>
              </a>
            ))}
          </nav>
          <h3>Files</h3>
          <nav className="files">
            {files.map((f) => (
              <span key={f.path} title={`${f.size} bytes`}>
                {f.path}
              </span>
            ))}
            <label className="upload">
              Upload a file
              <input type="file" hidden onChange={(e) => upload(e.target.files?.[0])} />
            </label>
          </nav>
          <footer>
            <span title={label}>{label}</span>
            <button type="button" onClick={onSignOut}>
              Sign out
            </button>
          </footer>
        </aside>
      )}
      <ResizeHandle
        label="Sidebar width"
        width={sidebarWidth}
        min={SIDEBAR_MIN}
        max={() => SIDEBAR_MAX}
        onResize={setSidebarWidth}
        onReset={() => setSidebarWidth(SIDEBAR_DEFAULT)}
        disabled={collapsed}
      />
      <main className="main" ref={chatRef}>
        {chatId ? (
          <ErrorBoundary key={chatId} what="this chat">
            <ChatView chatId={chatId} onArtifact={onArtifact} onActivity={refresh} />
          </ErrorBoundary>
        ) : (
          <div className="panel-empty">
            <button type="button" className="primary" onClick={newChat}>
              Start a chat
            </button>
          </div>
        )}
      </main>
      {preview && (
        <ResizeHandle
          label="Chat width"
          width={chatWidth ?? chatRef.current?.offsetWidth ?? CHAT_MIN}
          min={CHAT_MIN}
          max={() => (chatRef.current?.parentElement?.offsetWidth ?? innerWidth) - (collapsed ? RAIL_WIDTH : sidebarWidth) - PREVIEW_MIN}
          onResize={setChatWidth}
          onReset={() => setChatWidth(null)}
        />
      )}
      {preview && (
        <ErrorBoundary key={preview.artifactId} what="the preview">
          <ArtifactPanel artifactId={preview.artifactId} latestKnown={preview.version} uid={uid} onClose={() => setPreview(null)} />
        </ErrorBoundary>
      )}
    </div>
  );
}
