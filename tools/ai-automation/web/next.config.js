module.exports = {
  async rewrites() {
    return [
      {
        source: '/server/:path*',
        destination: 'http://localhost:4000/:path*',
      },
    ];
  },
};
