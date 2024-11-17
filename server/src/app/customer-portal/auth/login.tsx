'use client'

import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/Card'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [showTwoFactor, setShowTwoFactor] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const searchParams = useSearchParams()

  async function onSubmit(formData: FormData) {
    setError('')
    setIsLoading(true)

    try {
      const callbackUrl = searchParams?.get('callbackUrl') || '/customer-portal/dashboard'
      
      const result = await signIn('credentials', {
        email: formData.get('email') as string,
        password: formData.get('password') as string,
        twoFactorCode: formData.get('twoFactorCode') as string,
        redirect: false,
        callbackUrl,
      })

      if (result?.error) {
        if (result.error === '2FA_REQUIRED') {
          setShowTwoFactor(true)
          setError('Please enter your two-factor authentication code')
        } else {
          setError('Invalid email or password')
        }
      } else if (result?.url) {
        // Use window.location to handle the redirect
        window.location.href = result.url
      }
    } catch (error) {
      setError('An error occurred during login')
      console.error('Login error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Client Portal Login</CardTitle>
          <CardDescription>
            Please enter your credentials to access the customer portal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={onSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading || showTwoFactor}
                required
                className="w-full"
                autoComplete="email"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading || showTwoFactor}
                required
                className="w-full"
                autoComplete="current-password"
              />
            </div>

            {showTwoFactor && (
              <div className="space-y-2">
                <Label htmlFor="twoFactorCode">Two-Factor Code</Label>
                <Input
                  id="twoFactorCode"
                  name="twoFactorCode"
                  type="text"
                  placeholder="Enter your 2FA code"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  disabled={isLoading}
                  required
                  className="w-full"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                />
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <Link 
            href="/customer-portal/auth/forgot-password"
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            Forgot your password?
          </Link>
          <div className="text-sm text-gray-500">
            Don&apos;t have an account?{' '}
            <Link 
              href="/customer-portal/auth/register" 
              className="text-blue-600 hover:text-blue-800 transition-colors"
            >
              Register here
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
