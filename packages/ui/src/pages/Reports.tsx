export default function Reports() {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Reports</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white shadow rounded-lg p-4">
            <h2 className="text-xl font-semibold mb-2">Time Utilization</h2>
            <div className="h-64 bg-gray-200 flex items-center justify-center">
              [Time Utilization Chart Placeholder]
            </div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <h2 className="text-xl font-semibold mb-2">Project Progress</h2>
            <div className="h-64 bg-gray-200 flex items-center justify-center">
              [Project Progress Chart Placeholder]
            </div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <h2 className="text-xl font-semibold mb-2">Revenue by Client</h2>
            <div className="h-64 bg-gray-200 flex items-center justify-center">
              [Revenue by Client Chart Placeholder]
            </div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <h2 className="text-xl font-semibold mb-2">Team Performance</h2>
            <div className="h-64 bg-gray-200 flex items-center justify-center">
              [Team Performance Chart Placeholder]
            </div>
          </div>
        </div>
      </div>
    );
  }
  