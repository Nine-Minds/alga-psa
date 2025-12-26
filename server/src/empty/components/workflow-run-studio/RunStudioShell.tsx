import React from 'react';

type RunStudioShellProps = {
  runId: string;
};

const RunStudioShell: React.FC<RunStudioShellProps> = ({ runId }) => {
  return (
    <div className="p-6 text-sm text-gray-500">
      Workflow Run Studio is not available in this edition. (runId: {runId})
    </div>
  );
};

export default RunStudioShell;
