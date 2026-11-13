# 💌 Nuestra historia

Página-regalo con contador, carta, fotos, canción, vales de amor, ruleta y una pregunta final.
Se publica gratis con **GitHub Pages** y guarda todo en **Supabase** (base de datos gratuita), así que lo que se edita, se canjea o se responde queda guardado y se ve desde cualquier dispositivo.

```
index.html            Página
css/styles.css        Estilos
js/config.js          ← Aquí van tus claves de Supabase
js/app.js             Lógica
supabase/schema.sql   Base de datos (se pega una vez en Supabase)
```

## 1. Crear la base de datos (Supabase, ~5 min)

1. Entra en <https://supabase.com>, crea una cuenta y pulsa **New project** (plan Free).
2. Ve a **SQL Editor → New query**, pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**.
3. Crea tu usuario para editar: **Authentication → Users → Add user → Create new user** (tu correo y una contraseña; marca *Auto Confirm User*).
4. Desactiva el registro público: **Authentication → Sign In / Providers → Email** → desactiva **Allow new users to sign up**. Así nadie más puede crear una cuenta y editar.
5. Copia las claves: **Project Settings → API** (o *Data API*):
   - **Project URL** → `supabaseUrl`
   - **anon public** key → `supabaseAnonKey`

   y pégalas en [`js/config.js`](js/config.js). La clave *anon* es pública por diseño: la seguridad la ponen las reglas del `schema.sql`. **Nunca** pongas la clave `service_role`.

## 2. Publicar en GitHub Pages

1. Sube el repositorio a GitHub (`git push`).
2. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)` → **Save**.
3. En un minuto estará en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

## 3. Usarla

- **Para editar:** abre `https://…/NOMBRE-DEL-REPO/#editar`, inicia sesión y pulsa **✏️ Editar**. Las fotos y la canción se suben al guardar en el editor.
- **Para regalarla:** comparte el enlace **sin** `#editar`. Ella no verá el botón de editar.
- En el editor, apartado **💌 Lo que ha respondido**, verás su respuesta, el resultado de la ruleta y los vales que ha canjeado.

### Pasar los datos de la versión antigua
Abre `nuestra_historia.html` en el mismo navegador donde la personalizaste → **✏️ Editar → 📦 Exportar versión final**. Luego, en la nueva página: **✏️ Editar → Copias de seguridad e importación → 📥 Importar datos** y elige el `index.html` descargado. Revisa y pulsa **Guardar**.

## Qué se guarda y quién puede hacer qué

| | Visitante (con el enlace) | Tú (con sesión) |
|---|---|---|
| Ver la página | ✅ | ✅ |
| Canjear vales, girar la ruleta, responder | ✅ (validado en el servidor) | ✅ |
| Cambiar textos, fotos y canción | ❌ | ✅ |

> Ten en cuenta que la página es pública para quien tenga el enlace (también su respuesta). Tiene `noindex` para que no aparezca en buscadores.

## Probar en tu ordenador

Sin claves en `config.js` la página funciona en **modo local** (guarda solo en tu navegador):

```bash
python -m http.server 8765
```

y abre <http://localhost:8765>.
