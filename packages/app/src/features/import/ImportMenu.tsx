import { ChevronDown } from 'lucide-react';
import { useRef } from 'react';
import { DropdownMenu } from '../../components/DropdownMenu';
import { useT } from '../../lib/i18n';
import { smallIconProps } from '../../lib/icons';
import { useAppStore } from '../../stores/appStore';
import { showShareDialog } from '../export/ShareDialog';
import { showCurlImport } from './CurlImportDialog';
import { showPostmanApiImport } from './PostmanApiImportDialog';

/** Üst bardaki "İçe / dışa aktar" menüsü: Postman/Reqster dosyası seç, Postman API'den çek, cURL yapıştır, paket paylaş */
export function ImportMenu() {
  const t = useT();
  const importPostmanFile = useAppStore((s) => s.importPostmanFile);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onImportFile = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      await importPostmanFile(await file.text());
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <>
      <DropdownMenu
        label={
          <>
            {t('import.menu')}
            <span className="dropdown-caret">
              <ChevronDown {...smallIconProps} />
            </span>
          </>
        }
        items={[
          { label: t('import.fromFile'), onSelect: () => fileInputRef.current?.click() },
          { label: t('import.fromPostman'), onSelect: showPostmanApiImport },
          { label: t('import.fromCurl'), onSelect: showCurlImport },
          { kind: 'separator' },
          { label: t('share.menu'), onSelect: showShareDialog },
        ]}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        data-testid="import-file-input"
        onChange={(e) => void onImportFile(e.target.files)}
      />
    </>
  );
}
