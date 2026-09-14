CREATE TABLE admins (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(100) NOT NULL,
  email varchar(254) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE categories (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(80) NOT NULL DEFAULT '',
  name_en varchar(80) NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  CHECK (name <> '' OR name_en <> '')
);
CREATE TABLE media (
  id uuid PRIMARY KEY,
  filename text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  created_by integer REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sites (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(100) NOT NULL DEFAULT '',
  name_en varchar(100) NOT NULL DEFAULT '',
  description varchar(240) NOT NULL DEFAULT '',
  description_en varchar(240) NOT NULL DEFAULT '',
  url varchar(2048),
  icon_key varchar(30) NOT NULL DEFAULT 'globe',
  media_id uuid REFERENCES media(id),
  category_id integer REFERENCES categories(id) ON DELETE RESTRICT,
  keywords varchar(300) NOT NULL DEFAULT '',
  open_in_new_tab boolean NOT NULL DEFAULT true,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'hidden', 'placeholder')),
  sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_by integer REFERENCES admins(id),
  updated_by integer REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (name <> '' OR name_en <> ''),
  CHECK (status <> 'published' OR url ~* '^https?://')
);
CREATE INDEX sites_display_order ON sites(status, sort_order, id);
CREATE TABLE portal_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  title varchar(80) NOT NULL DEFAULT '员工门户',
  title_en varchar(80) NOT NULL DEFAULT 'Employee Portal',
  description varchar(200) NOT NULL DEFAULT '找到你需要的系统，开始一天的工作。',
  description_en varchar(200) NOT NULL DEFAULT 'Your work, one place to start.',
  logo_id uuid REFERENCES media(id),
  default_language varchar(2) NOT NULL DEFAULT 'zh' CHECK (default_language IN ('zh','en')),
  version integer NOT NULL DEFAULT 1,
  updated_by integer REFERENCES admins(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (title <> '' OR title_en <> '')
);
CREATE TABLE sessions (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX sessions_expire ON sessions(expire);
INSERT INTO portal_settings(id) VALUES (1);
INSERT INTO categories(name, name_en, sort_order) VALUES ('IT 服务', 'IT services', 0);
INSERT INTO sites(name, name_en, description, description_en, url, icon_key, category_id, status, sort_order)
VALUES ('IT HelpDesk', 'IT HelpDesk', '设备报修、技术支持与工单进度。', 'Technical support, service requests and ticket updates.', 'https://helpdesk.seg.com', 'headset', 1, 'published', 0),
       ('第二个网站', 'Another application', '网站名称、用途和地址待补充。', 'Details and address to be added.', NULL, 'grid', NULL, 'placeholder', 1);
