import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ChatSummary } from "../shared/protocol.ts";
import { api, type ArtifactSummary, type FileInfo } from "./api.ts";
import { ArtifactPanel } from "./artifact/ArtifactPanel.tsx";
import { ChatView, type PublishedArtifact } from "./chat/ChatView.tsx";

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
  const [uid, setUid] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    api.me().then((me) => setUid(me.uid), () => setUid(null));
  }, []);

  const shared = path.match(/^\/a\/([a-z0-9]+)$/);
  if (shared) {
    // A shared artifact: anyone with the link can view it, signed in or not.
    if (uid === undefined) return null;
    return <ArtifactPanel artifactId={shared[1]} uid={uid ?? undefined} fullPage />;
  }
  if (uid === undefined) return null;
  if (uid === null) return <SignIn onSignedIn={setUid} />;

  const chatId = path.match(/^\/c\/([a-z0-9]+)$/)?.[1];
  return (
    <Workspace
      uid={uid}
      chatId={chatId}
      navigate={navigate}
      onSignOut={async () => {
        await api.signOut();
        setUid(null);
        navigate("/");
      }}
    />
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
  chatId: string | undefined;
  navigate: (path: string) => void;
  onSignOut: () => void;
}

function Workspace({ uid, chatId, navigate, onSignOut }: WorkspaceProps) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [preview, setPreview] = useState<PublishedArtifact | null>(null);

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
    <div className={preview ? "workspace with-preview" : "workspace"}>
      <aside className="sidebar">
        <button type="button" className="primary" onClick={newChat}>
          + New chat
        </button>
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
          <span>{uid}</span>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </footer>
      </aside>
      <main className="main">
        {chatId ? (
          <ChatView key={chatId} chatId={chatId} onArtifact={onArtifact} onActivity={refresh} />
        ) : (
          <div className="panel-empty">
            <button type="button" className="primary" onClick={newChat}>
              Start a chat
            </button>
          </div>
        )}
      </main>
      {preview && (
        <ArtifactPanel artifactId={preview.artifactId} latestKnown={preview.version} uid={uid} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
