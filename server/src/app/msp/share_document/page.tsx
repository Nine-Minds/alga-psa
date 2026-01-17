import { TextEditor } from '@alga-psa/ui/editor';

// NOTE: Currently not being saved in the Database
export default async function TaskList() {

  return (
    <div>
      <form className='max-w-3xl w-full grid place-items-center mx-auto pt-10 mb-10'>
        <div className='text-3xl text-center text-purple-700 mb-10'>Document Editor</div>
        <TextEditor roomName='tip-tap-test' />
      </form>
    </div>
  );
}
