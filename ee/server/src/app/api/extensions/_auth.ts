import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth-compat'
import { hasPermission } from '@alga-psa/auth'
import { getCurrentUser } from '@alga-psa/users/actions'

type ExtensionPermissionAction = 'read' | 'write'

export async function requireExtensionApiAccess(action: ExtensionPermissionAction): Promise<NextResponse | null> {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const currentUser = await getCurrentUser()
  if (!currentUser) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (currentUser.user_type === 'client') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const allowed = await hasPermission(currentUser, 'extension', action)
  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  return null
}

