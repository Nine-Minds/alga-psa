import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExtensionContext, Statement } from '../types';
import { useSwoneQuery } from '../hooks/useSwoneQuery';

interface StatementsListProps {
  context: ExtensionContext;
}

export const StatementsList: React.FC<StatementsListProps> = ({ context }) => {
  const navigate = useNavigate();
  const { storage, logger } = context;
  
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [filter, setFilter] = useState<Statement['status'] | 'all'>('all');
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  });

  // Fetch statements from cache
  const { data: statements, isLoading, error } = useSwoneQuery<Statement[]>(
    ['statements', filter, dateRange.from, dateRange.to],
    async () => {
      const namespace = storage.getNamespace('swone');
      
      let allStatements = await namespace.get('statements') || [];
      
      // Filter by status
      if (filter !== 'all') {
        const byStatus = await namespace.get('statements/byStatus') || {};
        allStatements = byStatus[filter] || [];
      }
      
      // Filter by date range
      if (dateRange.from || dateRange.to) {
        allStatements = allStatements.filter((stmt: Statement) => {
          const stmtDate = new Date(stmt.periodEnd);
          const fromDate = dateRange.from ? new Date(dateRange.from) : new Date(0);
          const toDate = dateRange.to ? new Date(dateRange.to) : new Date();
          return stmtDate >= fromDate && stmtDate <= toDate;
        });
      }
      
      return allStatements;
    }
  );

  // Navigate to statement detail
  const handleRowClick = (row: Statement) => {
    navigate(`/softwareone/statement/${row.id}`);
  };

  // Handle row selection
  const handleRowSelection = (id: string) => {
    setSelectedRows(prev => {
      if (prev.includes(id)) {
        return prev.filter(rowId => rowId !== id);
      }
      return [...prev, id];
    });
  };

  const handleSelectAll = () => {
    if (selectedRows.length === statements?.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(statements?.map(s => s.id) || []);
    }
  };

  // Handle bulk billing
  const handleBulkBilling = async () => {
    if (selectedRows.length === 0) return;
    
    // This would integrate with Alga's billing system
    logger.info('Bulk billing requested for statements', { statementIds: selectedRows });
    
    // Placeholder for billing integration
    alert(`Billing integration for ${selectedRows.length} statements will be implemented in the next phase`);
  };

  if (error) {
    return (
      <div className="p-6">
        <div className="p-4 rounded-md bg-red-50 text-red-800 border border-red-200">
          Failed to load statements: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">SoftwareOne Statements</h1>
        
        <div className="flex gap-3">
          {selectedRows.length > 0 && (
            <button 
              onClick={handleBulkBilling}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Bill Selected ({selectedRows.length})
            </button>
          )}
          <button
            onClick={() => navigate('/softwareone/agreements')}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
          >
            View Agreements
          </button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-md text-sm ${
              filter === 'all' 
                ? 'bg-blue-600 text-white' 
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('draft')}
            className={`px-3 py-1 rounded-md text-sm ${
              filter === 'draft' 
                ? 'bg-blue-600 text-white' 
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            Draft
          </button>
          <button
            onClick={() => setFilter('final')}
            className={`px-3 py-1 rounded-md text-sm ${
              filter === 'final' 
                ? 'bg-blue-600 text-white' 
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            Final
          </button>
          <button
            onClick={() => setFilter('billed')}
            className={`px-3 py-1 rounded-md text-sm ${
              filter === 'billed' 
                ? 'bg-blue-600 text-white' 
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            Billed
          </button>
        </div>

        <div className="flex gap-2 items-center">
          <label className="text-sm text-gray-600">From:</label>
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
            className="px-3 py-1 border rounded"
          />
          <label className="text-sm text-gray-600">To:</label>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
            className="px-3 py-1 border rounded"
          />
        </div>
      </div>

      {statements && statements.length === 0 ? (
        <div className="p-4 rounded-md bg-blue-50 text-blue-800 border border-blue-200">
          <p>No statements found for the selected criteria.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedRows.length === statements?.length && statements?.length > 0}
                      onChange={handleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Statement #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Period Start
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Period End
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Charges
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                      Loading...
                    </td>
                  </tr>
                ) : (
                  statements?.map((statement) => (
                    <tr 
                      key={statement.id} 
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleRowClick(statement)}
                    >
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedRows.includes(statement.id)}
                          onChange={() => handleRowSelection(statement.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRowClick(statement);
                          }}
                          className="text-blue-600 hover:underline font-mono"
                        >
                          {statement.statementNumber}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(statement.periodStart).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(statement.periodEnd).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900">
                        {statement.currency} {statement.totalAmount.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {statement.charges?.length || 0} items
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          statement.status === 'draft' ? 'bg-yellow-100 text-yellow-800' :
                          statement.status === 'final' ? 'bg-blue-100 text-blue-800' :
                          statement.status === 'billed' ? 'bg-green-100 text-green-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {statement.status.charAt(0).toUpperCase() + statement.status.slice(1)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedRows.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600">
              {selectedRows.length} statement{selectedRows.length > 1 ? 's' : ''} selected
            </p>
            <div className="text-sm font-medium">
              Total selected: {
                statements
                  ?.filter(s => selectedRows.includes(s.id))
                  .reduce((sum, s) => sum + s.totalAmount, 0)
                  .toLocaleString()
              } {statements?.[0]?.currency}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};