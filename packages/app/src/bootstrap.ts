import './lib/session'; // oturum token'ı adresten alınır; ilk API çağrısından önce
import { initLanguage } from './lib/i18n';
import { initTheme } from './lib/theme';

// main.tsx'te App'ten ÖNCE import edilir: ESM import'ları gövdeden önce değerlendirildiği için store modülü
// (açılış sekmesinin adı t('request.newName') ile kurulur) dil seçilmeden yüklenip ilk sekmeyi İngilizce adlandırıyordu.
initTheme();
initLanguage(); // ilk render'dan önce: metinler doğru dilde boyansın
