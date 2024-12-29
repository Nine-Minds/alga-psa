import { Anthropic } from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: Request) {
  const { messages } = await req.json();
  
  const completion = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    system: 'You are a helpful assistant that generates Puppeteer scripts',
    messages: messages.filter((msg: { role: string }) => msg.role !== 'system'),
    max_tokens: 1024,
    temperature: 0.2
  });

  console.log(completion);

  const reply = completion.content
    .map(block => block.type === 'text' ? block.text : '')
    .join('') || '';
  return NextResponse.json({ reply });
}
