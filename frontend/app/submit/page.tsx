import { SubmitForm } from '@/src/components/submit-form';
import { fetchDirectories, type Directories } from '@/src/lib/api';

/**
 * Справочники тянутся на сервере: форма с номинациями без них бесполезна, а просить браузер
 * сходить за ними после загрузки — лишняя секунда пустых селектов.
 */
export const dynamic = 'force-dynamic';

const EMPTY: Directories = { weapons: [], cities: [], macroRegions: [] };

export default async function SubmitPage() {
  // Справочники не приехали — форму всё равно показываем: оружие впишут словами, город строкой.
  const directories = await fetchDirectories().catch(() => EMPTY);
  return <SubmitForm directories={directories} />;
}
