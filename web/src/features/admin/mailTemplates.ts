// Panel admina „Maile”: edycja szablonów maili (gra i Supabase Auth) z podglądem na żywo.
// Serwer: routes/mail_admin.rs (/api/admin/email-templates). Podgląd to <iframe sandbox="" srcdoc>, więc treść maila
// nie ma dostępu do panelu ani nie uruchamia skryptów.
import { api } from '../../api/client';
import { toast } from '../../ui/Toaster';

interface Placeholder { name: string; desc: string; sample: string }
interface Template {
  name: string;
  desc: string;
  subject: string;
  html: string;
  isDefault: boolean;
  subjectUsed: boolean;
  required: string[];
  placeholders: Placeholder[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Jak serwer (mail_templates::render): {{ .Nazwa }} z escapowaniem wartości */
function render(tpl: string, placeholders: Placeholder[]) {
  return tpl.replace(/\{\{\s*\.(\w+)\s*\}\}/g, (m, name: string) => {
    const p = placeholders.find(x => x.name === name);
    return p ? esc(p.sample) : m;
  });
}

const TITLES: Record<string, string> = {
  password_reset: 'Reset hasła',
  email_change_request: 'Zmiana emaila (link)',
  email_changed_notice: 'Email zmieniony (powiadomienie)',
  email_verify: 'Potwierdzenie emaila (link, 24 h)',
  confirmation:'Potwierdzenie konta (Supabase)',
  recovery: 'Nowe hasło (Supabase)',
  email_change: 'Zmiana emaila (Supabase)'
};

export function initMailTemplates() {
  const root = document.getElementById('mailBody');
  if (!root) return;
  let list: Template[] = [];
  let smtp = false;
  let current = '';
  let timer = 0;

  const draft = new Map<string, { subject: string; html: string }>();
  const cur = () => list.find(t => t.name === current);

  root.innerHTML = `
    <div class="a-mail-tabs" id="mailTabs" role="group" aria-label="Szablony maili"></div>
    <div id="mailEditor" hidden>
      <p class="muted small" id="mailDesc"></p>
      <label class="a-mail-field">Temat<input type="text" id="mailSubject" maxlength="200" autocomplete="off"></label>
      <div class="a-mail-cols">
        <div>
          <label class="a-mail-field">Treść HTML<textarea id="mailHtml" spellcheck="false" rows="22"></textarea></label>
          <div class="muted small">Pola do wstawienia w miejsce kursora (kliknij):</div>
          <div class="a-mail-chips" id="mailChips"></div>
        </div>
        <div>
          <div class="muted small">Podgląd na żywo (przykładowe wartości pól)</div>
          <iframe id="mailPreview" class="a-mail-preview" sandbox="" title="Podgląd maila"></iframe>
        </div>
      </div>
      <div class="a-mail-actions">
        <button class="btn primary" type="button" id="mailSave">Zapisz</button>
        <button class="btn" type="button" id="mailReset">Przywróć domyślny</button>
        <button class="btn" type="button" id="mailTest">Wyślij test do mnie</button>
        <span class="muted small" id="mailState"></span>
      </div>
    </div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;
  const subject = $<HTMLInputElement>('mailSubject'), html = $<HTMLTextAreaElement>('mailHtml'), preview = $<HTMLIFrameElement>('mailPreview');

  const store = () => { const t = cur(); if (t) draft.set(t.name, { subject: subject.value, html: html.value }); };
  const refreshPreview = () => { const t = cur(); if (t) preview.srcdoc = render(html.value, t.placeholders); };
  const schedulePreview = () => { window.clearTimeout(timer); timer = window.setTimeout(refreshPreview, 250); };

  const status = () => {
    const t = cur();
    if (!t) return;
    const d = draft.get(t.name);
    const changed = !!d && (d.subject !== t.subject || d.html !== t.html);
    $('mailState').textContent = `${t.isDefault ? 'Domyślny' : 'Zmieniony w panelu'}${changed ? ' · niezapisane zmiany' : ''}${t.subjectUsed ? '' : ' · temat tego maila ustawia GOTRUE_MAILER_SUBJECTS_*'}${smtp ? '' : ' · brak SMTP_URL: próbny mail trafi tylko do logu serwera'}`;
  };

  const drawTabs = () => {
    $('mailTabs').innerHTML = list.map(t => `<button type="button" class="btn tiny" data-mail="${esc(t.name)}" aria-pressed="${t.name === current}">${esc(TITLES[t.name] ?? t.name)}${t.isDefault ? '' : ' *'}</button>`).join('');
  };

  const show = (name: string) => {
    store();
    current = name;
    const t = cur();
    if (!t) return;
    const d = draft.get(name) ?? { subject: t.subject, html: t.html };
    $('mailEditor').hidden = false;
    $('mailDesc').textContent = t.desc;
    subject.value = d.subject;
    html.value = d.html;
    $('mailChips').innerHTML = t.placeholders
      .map(p => `<button type="button" class="btn tiny" data-ph="${esc(p.name)}" title="${esc(p.desc)} (przykład: ${esc(p.sample)})">{{ .${esc(p.name)} }}${t.required.includes(p.name) ? ' *' : ''}</button>`)
      .join('') + '<span class="muted small">* wymagane</span>';
    drawTabs();
    refreshPreview();
    status();
  };

  const load = async (keep?: string) => {
    const r = await api<{ templates: Template[]; smtp: boolean }>('/api/admin/email-templates');
    list = r.templates;
    smtp = r.smtp;
    draft.clear();
    current = '';   // show() nie zapisze starej treści formularza jako wersji roboczej
    show(keep && list.some(t => t.name === keep) ? keep : list[0]?.name ?? '');
  };

  root.addEventListener('click', async e => {
    const el = e.target as HTMLElement;
    const tab = el.closest<HTMLElement>('[data-mail]');
    const ph = el.closest<HTMLElement>('[data-ph]');
    try {
      if (tab) show(tab.dataset.mail!);
      else if (ph) {
        const text = `{{ .${ph.dataset.ph} }}`;
        const a = html.selectionStart ?? html.value.length, b = html.selectionEnd ?? a;
        html.setRangeText(text, a, b, 'end');
        html.focus();
        store(); status(); schedulePreview();
      } else if (el.id === 'mailSave') {
        await api(`/api/admin/email-templates/${current}`, { subject: subject.value, html: html.value });
        toast('Zapisano szablon maila');
        await load(current);
      } else if (el.id === 'mailReset') {
        if (!confirm('Przywrócić domyślną treść tego maila? Twoje zmiany przepadną.')) return;
        await api(`/api/admin/email-templates/${current}/reset`, {});
        toast('Przywrócono domyślny szablon');
        await load(current);
      } else if (el.id === 'mailTest') {
        const r = await api<{ smtp: boolean }>(`/api/admin/email-templates/${current}/test`, { subject: subject.value, html: html.value });
        toast(r.smtp ? 'Wysłano mail próbny na Twój email' : 'Brak SMTP_URL - mail próbny zapisany tylko w logu serwera');
      }
    } catch (err: any) { toast(err.message, true); }
  });
  const edited = () => { store(); status(); schedulePreview(); };
  subject.addEventListener('input', edited);
  html.addEventListener('input', edited);

  load().catch((err: any) => toast(err.message, true));
}
