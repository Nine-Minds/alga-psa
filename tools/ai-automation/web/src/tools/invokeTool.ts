const API_BASE = 'http://localhost:4000/api';

// 1) Observe Browser
export async function observeBrowser(selector?: string) {
  const endpoint = `${API_BASE}/observe${selector ? `?selector=${encodeURIComponent(selector)}` : ''}`;
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
    });
    
    if (!response.ok) {
      const error = `Failed to observe: ${response.status}`;
      throw new Error(error);
    }

    const result = await response.json();
    const successResult = { success: true, result };
    return successResult;
  } catch (error) {
    const errorResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    return errorResult;
  }
}

// 2) Execute Browser Script
export async function executeScript(code: string) {
  const endpoint = `${API_BASE}/script`;
  const body = { code };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = `Failed to execute script: ${response.status}`;
      throw new Error(error);
    }

    const result = await response.json();
    
    const successResult = { success: true, result };
    return successResult;
  } catch (error) {
    const errorResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    return errorResult;
  }
}
