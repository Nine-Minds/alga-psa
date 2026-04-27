import { TextEditor } from '@alga-psa/ui/editor';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Share Document',
};

// NOTE: Currently not being saved in the Database
export default async function TaskList() {
  const { t } = await getServerTranslation(undefined, 'common');

  return (
    <div>
      <form className='max-w-3xl w-full grid place-items-center mx-auto pt-10 mb-10'>
        <div className='text-3xl text-center text-purple-700 mb-10'>{t('pages.titles.documentEditor')}</div>
        <TextEditor roomName='tip-tap-test' />
      </form>
    </div>
  );
}
