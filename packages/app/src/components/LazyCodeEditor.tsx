import { Suspense, lazy } from 'react';
import type { CodeEditorProps } from './CodeEditor';

// CodeMirror + dil paketleri ayrı bir chunk'ta: ana bundle küçük kalır (TASARIM.md "hafif" ilkesi),
// editör yalnızca ilk gerçekten gösterildiğinde indirilir.
const LazyImpl = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })));

export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense
      fallback={
        <div
          className={`code-editor-host ${props.className ?? ''}`}
          style={{ minHeight: props.minHeightPx ?? 120 }}
        />
      }
    >
      <LazyImpl {...props} />
    </Suspense>
  );
}
