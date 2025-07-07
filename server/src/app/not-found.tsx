export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-900">404</h1>
        <p className="mt-4 text-xl text-gray-600">Page not found</p>
        <a href="/" className="mt-6 inline-block text-blue-600 hover:text-blue-800">
          Go back home
        </a>
      </div>
    </div>
  );
}