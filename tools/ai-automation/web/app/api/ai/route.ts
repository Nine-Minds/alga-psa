import { Anthropic } from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: Request) {
  const { messages } = await req.json();
  
  const completion = await anthropic.messages.create({
    model: 'claude-3-opus-20240229',
    messages,
    max_tokens: 1024,
    temperature: 0.2
  });

  const reply = completion.content
    .map(block => block.type === 'text' ? block.text : '')
    .join('') || '';
  return NextResponse.json({ reply });
}
