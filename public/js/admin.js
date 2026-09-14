(() => {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content;

  // Confirm destructive form submissions.
  for (const form of document.querySelectorAll('form[data-confirm]')) {
    form.addEventListener('submit', event => { if (!confirm(form.dataset.confirm)) event.preventDefault(); });
  }

  // Live card preview on the site editor.
  const form = document.querySelector('[data-site-form]');
  const preview = document.querySelector('[data-preview]');
  if (form && preview) {
    const card = preview.querySelector('.card');
    const lang = preview.dataset.lang;
    const field = name => form.elements[name];
    const pick = (zh, en) => (lang === 'en' ? en || zh : zh || en);
    const iconSlot = preview.querySelector('[data-preview="icon"]');
    let objectUrl = null;

    const update = () => {
      preview.querySelector('[data-preview="name"]').textContent = pick(field('name').value.trim(), field('name_en').value.trim()) || preview.dataset.fallbackName;
      preview.querySelector('[data-preview="description"]').textContent = pick(field('description').value.trim(), field('description_en').value.trim());

      const select = field('category_id');
      let category = preview.querySelector('[data-preview="category"]');
      if (select.value) {
        if (!category) {
          category = Object.assign(document.createElement('span'), { className: 'card-category' });
          category.dataset.preview = 'category';
          card.querySelector('.card-head').append(category);
        }
        category.textContent = select.selectedOptions[0].textContent;
      } else category?.remove();

      const file = field('icon_file').files[0];
      const removeUpload = field('remove_icon')?.checked;
      const existing = iconSlot.dataset.uploaded;
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      if (file) {
        objectUrl = URL.createObjectURL(file);
        iconSlot.replaceChildren(Object.assign(document.createElement('img'), { src: objectUrl, alt: '' }));
      } else if (existing && !removeUpload) {
        iconSlot.replaceChildren(Object.assign(document.createElement('img'), { src: existing, alt: '' }));
      } else {
        const checked = form.querySelector('input[name="icon_key"]:checked');
        const svg = checked?.nextElementSibling.querySelector('svg');
        if (svg) iconSlot.replaceChildren(svg.cloneNode(true));
      }

      const hasUrl = /^https?:\/\/\S+/i.test(field('url').value.trim());
      const foot = card.querySelector('.card-foot');
      const button = document.createElement('span');
      button.className = 'card-open';
      button.textContent = hasUrl ? `${preview.dataset.openLabel} →` : preview.dataset.soonLabel;
      if (!hasUrl) button.setAttribute('aria-disabled', 'true');
      foot.replaceChildren(button);
      card.classList.toggle('is-placeholder', !hasUrl);
    };

    const img = iconSlot.querySelector('img');
    if (img) iconSlot.dataset.uploaded = img.getAttribute('src');
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    update();
  }

  // Drag-and-drop ordering; the ↑/↓ buttons remain for keyboard and touch users.
  const list = document.querySelector('[data-sortable]');
  if (list && csrf) {
    let dragged = null;
    const rows = () => [...list.querySelectorAll('.site-row')];
    const clearMarks = () => rows().forEach(r => r.classList.remove('drop-before', 'drop-after'));

    list.addEventListener('dragstart', event => {
      const handle = event.target.closest('.drag-handle');
      if (!handle) return;
      dragged = handle.closest('.site-row');
      dragged.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setDragImage(dragged, 20, 20);
    });
    list.addEventListener('dragover', event => {
      if (!dragged) return;
      const row = event.target.closest('.site-row');
      if (!row || row === dragged) return;
      event.preventDefault();
      clearMarks();
      const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
      row.classList.add(after ? 'drop-after' : 'drop-before');
    });
    list.addEventListener('drop', async event => {
      if (!dragged) return;
      const row = event.target.closest('.site-row');
      event.preventDefault();
      if (row && row !== dragged) row[row.classList.contains('drop-after') ? 'after' : 'before'](dragged);
      clearMarks();
      const ids = rows().map(r => Number(r.dataset.id));
      const response = await fetch('/api/admin/sites/order', {
        method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ ids }),
      }).catch(() => null);
      if (!response?.ok) {
        document.querySelector('[data-order-error]').hidden = false;
        setTimeout(() => location.reload(), 1500);
        return;
      }
      // Keep the ↑/↓ buttons' disabled state in step with the new order.
      rows().forEach((r, i, all) => {
        r.querySelector('button[value="up"]').disabled = i === 0;
        r.querySelector('button[value="down"]').disabled = i === all.length - 1;
      });
    });
    list.addEventListener('dragend', () => { dragged?.classList.remove('dragging'); dragged = null; clearMarks(); });
  }
})();
