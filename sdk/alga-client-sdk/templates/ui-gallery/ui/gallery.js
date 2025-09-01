export function renderGallery(root, items) {
  if (!root) return;
  root.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.style.display = 'grid';
  wrapper.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
  wrapper.style.gap = '12px';
  items.forEach((it) => {
    const card = document.createElement('div');
    card.style.border = '1px solid #ddd';
    card.style.borderRadius = '8px';
    card.style.padding = '12px';
    const h3 = document.createElement('h3');
    h3.textContent = it.title;
    const p = document.createElement('p');
    p.textContent = it.description;
    const btn = document.createElement('button');
    btn.textContent = 'Run';
    btn.onclick = () => it.action?.();
    card.append(h3, p, btn);
    wrapper.appendChild(card);
  });
  root.appendChild(wrapper);
}

