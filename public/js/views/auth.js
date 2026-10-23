import { html, $, api } from '../util.js';
import { ctx } from '../state.js';

export function render(root, { onAuthed }) {
  let mode = 'login';

  const art = () => html`
    <section class="auth-art">
      <a class="brand" href="#/"><img src="/pieces/wN.svg" alt=""><span class="display">${ctx.config.clubName}</span></a>
      <div>
        <h1 class="display">Find your next opponent.</h1>
        <p>Club events, announcements and online tournaments in one place. Register with your student ID to join the next round.</p>
      </div>
      <div class="auth-board" aria-hidden="true"></div>
    </section>`;

  const loginForm = () => html`
    <form novalidate>
      <h2 class="display">Log in</h2>
      <p class="lead">Welcome back. Use your student ID and password.</p>
      <p class="form-error" hidden></p>
      <label class="field"><span>Student ID</span><input name="studentId" autocomplete="username" required autofocus></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn block" type="submit">Log in</button>
      <p class="auth-switch">New to the club? <a href="#" data-switch>Create an account</a></p>
    </form>`;

  const registerForm = () => html`
    <form novalidate>
      <h2 class="display">Join the club</h2>
      <p class="lead">Your photo appears on pairing charts so opponents know who they’re playing.</p>
      <p class="form-error" hidden></p>
      <div class="photo-pick">
        <span class="avatar lg" data-preview>+</span>
        <label>
          <input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/gif" required>
          <span class="btn secondary small">Choose photo</span>
        </label>
      </div>
      <label class="field"><span>Student ID</span><input name="studentId" autocomplete="username" required autofocus></label>
      <div class="row">
        <label class="field"><span>First name</span><input name="firstName" autocomplete="given-name" required></label>
        <label class="field"><span>Surname</span><input name="lastName" autocomplete="family-name" required></label>
      </div>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password" minlength="6" required><small>At least 6 characters</small></label>
      <button class="btn block" type="submit">Create account</button>
      <p class="auth-switch">Already a member? <a href="#" data-switch>Log in</a></p>
    </form>`;

  function draw() {
    root.innerHTML = html`
      <div class="auth">
        ${art()}
        <section class="auth-form">${mode === 'login' ? loginForm() : registerForm()}</section>
      </div>`.s;

    const form = $('form', root);
    const errEl = $('.form-error', form);

    $('[data-switch]', form).onclick = (e) => {
      e.preventDefault();
      mode = mode === 'login' ? 'register' : 'login';
      draw();
    };

    const photo = form.elements.photo;
    photo?.addEventListener('change', () => {
      const file = photo.files[0];
      const preview = $('[data-preview]', form);
      if (!file) return;
      const img = document.createElement('img');
      img.className = 'avatar lg';
      img.alt = '';
      img.src = URL.createObjectURL(file);
      img.dataset.preview = '';
      preview.replaceWith(img);
    });

    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('[type=submit]', form);
      btn.disabled = true;
      errEl.hidden = true;
      try {
        const data = new FormData(form);
        const me = mode === 'login'
          ? await api('/api/login', { method: 'POST', body: Object.fromEntries(data) })
          : await api('/api/register', { method: 'POST', form: data });
        onAuthed(me);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        btn.disabled = false;
      }
    };
  }

  draw();
}
