export async function* evaluatePrompt(
  _prompt: string,
  _hf: unknown,
  _selectedAccount: string,
  _selectedUserId: string,
  _controller: AbortController,
  _authToken: string,
  _chatId: string,
  _messageCount: number,
  _onToken: (text: string) => void,
) {
  yield {
    error: true,
    message: 'Chat streaming is only available in Enterprise Edition',
  };
}

export async function* evaluatePromptTitle(
  _prompt: string,
  _hf: unknown,
  _selectedAccount: string,
  _selectedUserId: string,
  _controller: AbortController,
  _authToken: string,
  _chatId: string,
  _messageCount: number,
  _onToken: (text: string) => void,
) {
  yield {
    error: true,
    message: 'Title streaming is only available in Enterprise Edition',
  };
}
