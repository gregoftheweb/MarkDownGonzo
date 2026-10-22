import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ImageOff, Trash2, Unlink } from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { readImageDataUrl, trashImageFile } from "./backend";

interface ImageOptions {
  documentPath: string | null;
  loadRemote: boolean;
}

const MIN_IMAGE_WIDTH = 60;

export function ImageNodeView({ node, selected, deleteNode, updateAttributes, extension }: NodeViewProps) {
  const source = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const widthAttr = node.attrs.width;
  const storedWidth = typeof widthAttr === "string" || typeof widthAttr === "number" ? Number(widthAttr) : null;
  const options = extension.options as ImageOptions;
  const [displaySource, setDisplaySource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remote = /^https?:\/\//i.test(source);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDisplaySource(null);

    if (remote) {
      if (options.loadRemote) setDisplaySource(source);
      else setError("Remote images are disabled in config.toml");
      return () => {
        cancelled = true;
      };
    }
    if (source.startsWith("data:")) {
      setDisplaySource(source);
      return () => {
        cancelled = true;
      };
    }
    if (!options.documentPath) {
      setError("Save this document before adding local images");
      return () => {
        cancelled = true;
      };
    }

    void readImageDataUrl(options.documentPath, source)
      .then((dataUrl) => {
        if (!cancelled) setDisplaySource(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setError(`Missing image: ${source}`);
      });
    return () => {
      cancelled = true;
    };
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

  // Drag-resize: live width tracks the pointer during the drag for a smooth
  // preview, then commits once on pointerup via updateAttributes so the
  // document only gets one history entry (and one markdown re-render) per
  // resize, not one per pixel of movement.
  const beginResize = (event: React.PointerEvent<HTMLSpanElement>) => {
    const img = imgRef.current;
    if (!img) return;
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = { startX: event.clientX, startWidth: img.getBoundingClientRect().width };

    const handleMove = (moveEvent: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      const next = Math.max(MIN_IMAGE_WIDTH, Math.round(resizeState.startWidth + (moveEvent.clientX - resizeState.startX)));
      setLiveWidth(next);
    };
    const finishResize = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finishResize);
      const resizeState = resizeStateRef.current;
      resizeStateRef.current = null;
      if (!resizeState) return;
      const committedImg = imgRef.current;
      const finalWidth = committedImg ? Math.max(MIN_IMAGE_WIDTH, Math.round(committedImg.getBoundingClientRect().width)) : null;
      setLiveWidth(null);
      if (finalWidth) updateAttributes({ width: String(finalWidth) });
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", finishResize);
  };

  const effectiveWidth = liveWidth ?? storedWidth;

  return (
    <NodeViewWrapper className={`image-node${selected ? " selected" : ""}`}>
      {displaySource ? (
        <img
          ref={imgRef}
          src={displaySource}
          alt={alt}
          style={effectiveWidth ? { width: `${effectiveWidth}px` } : undefined}
          onError={() => setError(`Unable to display: ${source}`)}
        />
      ) : (
        <div className="missing-image">
          <ImageOff size={28} />
          <strong>{error ?? "Loading image…"}</strong>
          <small>{source}</small>
        </div>
      )}
      {selected && displaySource && <span className="image-resize-handle" onPointerDown={beginResize} title="Drag to resize" />}
      {selected && (
        <div className="image-actions">
          <button type="button" onClick={deleteNode} title="Remove reference only">
            <Unlink size={14} /> Remove
          </button>
          {!remote && !source.startsWith("data:") && (
            <button type="button" className="danger" onClick={() => void trashFile()} title="Move the image file to Trash">
              <Trash2 size={14} /> Trash file
            </button>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}
