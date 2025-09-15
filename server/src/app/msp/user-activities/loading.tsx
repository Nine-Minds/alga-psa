import Spinner from 'server/src/components/ui/Spinner';

export default function UserActivitiesLoading() {
  return (
    <div className="flex items-center justify-center h-screen">
      <Spinner size="lg" />
    </div>
  );
}