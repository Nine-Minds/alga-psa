import { renderGallery } from './gallery.js';

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('app');
  renderGallery(root, [
    { title: 'Hello', description: 'Hello world card', action: () => alert('Hello from __PACKAGE_NAME__!') },
    { title: 'Pack', description: 'Pack the project', action: () => console.log('Use `alga pack-project --project . --out dist/bundle.tar.zst`') }
  ]);
});

