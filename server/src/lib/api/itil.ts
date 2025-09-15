import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import ItilService from '../services/itilService';
import { getKnex } from '../db';

// Request schemas
const updatePrioritySchema = z.object({
  ticketId: z.string().uuid(),
  impact: z.number().int().min(1).max(5),
  urgency: z.number().int().min(1).max(5)
});

const autoCategorizeSchema = z.object({
  ticketId: z.string().uuid(),
  title: z.string(),
  description: z.string()
});

const createProblemSchema = z.object({
  incidentId: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  rootCause: z.string().optional(),
  workaround: z.string().optional()
});

const metricsSchema = z.object({
  startDate: z.string(),
  endDate: z.string()
});

/**
 * Update ticket priority based on ITIL impact and urgency
 */
export async function updateTicketPriority(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const validatedData = updatePrioritySchema.parse(body);
    
    const knex = await getKnex();
    const itilService = new ItilService(knex);
    
    await itilService.updateTicketPriority(
      validatedData.ticketId,
      validatedData.impact,
      validatedData.urgency
    );
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating ticket priority:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Auto-categorize ticket based on content
 */
export async function autoCategorizeTicket(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const validatedData = autoCategorizeSchema.parse(body);
    
    const knex = await getKnex();
    const itilService = new ItilService(knex);
    
    await itilService.autoCategorizeTicket(
      validatedData.ticketId,
      validatedData.title,
      validatedData.description
    );
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error auto-categorizing ticket:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Check for SLA breaches
 */
export async function checkSlaBreaches(request: NextRequest): Promise<NextResponse> {
  try {
    const knex = await getKnex();
    const itilService = new ItilService(knex);
    
    const breachedTickets = await itilService.checkSlaBreaches();
    
    return NextResponse.json({
      success: true,
      breachedTickets
    });
  } catch (error) {
    console.error('Error checking SLA breaches:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Get tickets requiring escalation
 */
export async function getTicketsForEscalation(request: NextRequest): Promise<NextResponse> {
  try {
    const knex = await getKnex();
    const itilService = new ItilService(knex);
    
    const tickets = await itilService.getTicketsForEscalation();
    
    return NextResponse.json({
      success: true,
      tickets
    });
  } catch (error) {
    console.error('Error getting tickets for escalation:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Get ITIL metrics
 */
export async function getItilMetrics(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }
    
    const validatedData = metricsSchema.parse({ startDate, endDate });
    
    const knex = await getKnex();
    const itilService = new ItilService(knex);
    
    const metrics = await itilService.getItilMetrics(
      new Date(validatedData.startDate),
      new Date(validatedData.endDate)
    );
    
    return NextResponse.json({
      success: true,
      metrics
    });
  } catch (error) {
    console.error('Error getting ITIL metrics:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Create problem record from incident
 */
export async function createProblemFromIncident(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const validatedData = createProblemSchema.parse(body);
    
    const knex = await getKnex();
    const itilService = new ItilService(knex);
    
    const problemId = await itilService.createProblemFromIncident(
      validatedData.incidentId,
      {
        title: validatedData.title,
        description: validatedData.description,
        rootCause: validatedData.rootCause,
        workaround: validatedData.workaround
      }
    );
    
    return NextResponse.json({
      success: true,
      problemId
    });
  } catch (error) {
    console.error('Error creating problem from incident:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Route handler for ITIL API endpoints
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { pathname } = new URL(request.url);
  
  switch (pathname) {
    case '/api/itil/update-priority':
      return updateTicketPriority(request);
    case '/api/itil/auto-categorize':
      return autoCategorizeTicket(request);
    case '/api/itil/create-problem':
      return createProblemFromIncident(request);
    default:
      return NextResponse.json(
        { error: 'Endpoint not found' },
        { status: 404 }
      );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { pathname } = new URL(request.url);
  
  switch (pathname) {
    case '/api/itil/sla-breaches':
      return checkSlaBreaches(request);
    case '/api/itil/escalations':
      return getTicketsForEscalation(request);
    case '/api/itil/metrics':
      return getItilMetrics(request);
    default:
      return NextResponse.json(
        { error: 'Endpoint not found' },
        { status: 404 }
      );
  }
}