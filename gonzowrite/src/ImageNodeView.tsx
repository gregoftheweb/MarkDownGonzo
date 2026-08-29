import { useEffect, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ImageOff, Trash2, Unlink } from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { readImageDataUrl, trashImageFile } from "./backend";

interface ImageOptions {
  documentPath: string | null;
  loadRemote: boolean;
}

export function ImageNodeView({ node, selected, deleteNode, extension }: NodeViewProps) {
  const source = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const options = extension.options as ImageOptions;
  const [displaySource, setDisplaySource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remote = /^https?:\/\//i.test(source);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDisplaySource(null);

    if (remote) {
      if (options.loadRemote) setDisplaySource(source);
      else setError("Remote images are disabled in config.toml");
      return () => { cancelled = true; };
    }
    if (source.startsWith("data:")) {
      setDisplaySource(source);
      return () => { cancelled = true; };
    }
    if (!options.documentPath) {
      setError("Save this document before adding local images");
      return () => { cancelled = true; };
    }

    void readImageDataUrl(options.documentPath, source)
      .then((dataUrl) => { if (!cancelled) setDisplaySource(dataUrl); })
      .catch(() => { if (!cancelled) setError(`Missing image: ${source}`); });
    return () => { cancelled = true; };
  }, [options.documentPath, options.loadRemote, remote, source]);

  const trashFile = async () => {
    if (!options.documentPath || remote || source.startsWith("data:")) return;
    const approved = await confirm(`Move ${source} to Trash and remove it from this document?`, {
      title: "Delete image file",
      kind: "warning",
    });
    if (!approved) return;
    try {
      await trashImageFile(options.documentPath, source);
      deleteNode();
    } catch {
      setError(`Could not move ${source} to Trash`);
    }
  };

  return <NodeViewWrapper className={`image-node${selected ? " selected" : ""}`}>
    {displaySource ? <img src={displaySource} alt={alt} onError={() => setError(`Unable to display: ${source}`)} />
      : <div className="missing-image"><ImageOff size={28} /><strong>{error ?? "Loading image…"}</strong><small>{source}</small></div>}
    {selected && <div className="image-actions">
      <button type="button" onClick={deleteNode} title="Remove reference only"><Unlink size={14} /> Remove</button>
      {!remote && !source.startsWith("data:") && <button type="button" className="danger" onClick={() => void trashFile()} title="Move the image file to Trash">
        <Trash2 size={14} /> Trash file
      </button>}
    </div>}
  </NodeViewWrapper>;
}

