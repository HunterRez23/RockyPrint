-- =========================================================
-- RockyPrint · Esquema inicial (ES)
-- - Clientes, Pedidos, Partidas
-- - Biblioteca de medios (bytea en Postgres)
-- - Diseños ligados a pedido/partida
-- - Índices, vistas y triggers
-- =========================================================

-- ========== CLIENTES ==========

create table if not exists clientes (
  id            serial primary key,
  nombre        varchar(200) not null,
  telefono      varchar(50),
  correo        varchar(200),
  rfc           varchar(30),
  facturar      boolean default false,
  canal         varchar(30),         -- Mostrador, WhatsApp, etc.
  creado_en     timestamp default now()
);

-- ========== TIPOS ENUM ==========

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_pedido') then
    create type estado_pedido as enum ('Pendiente','En revisión','En producción','Listo','Entregado','Cancelado');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_diseno') then
    create type estado_diseno as enum ('borrador','aprobado','listo');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'tipo_uso_medio') then
    create type tipo_uso_medio as enum ('logo','referencia','mockup','arte_final','otro');
  end if;
end$$;

-- ========== PEDIDOS ==========

create table if not exists pedidos (
  id              serial primary key,
  folio           varchar(40) unique not null,
  cliente_id      int references clientes(id) on delete set null,
  estado          estado_pedido not null default 'Pendiente',
  sucursal_usuario varchar(120),                -- "Matriz / Omar"
  prioridad       varchar(20) default 'Normal', -- Normal/Urgente/Express
  fecha_entrega   date,
  hora_entrega    time,
  total           numeric(12,2) not null default 0,
  anticipo        numeric(12,2) not null default 0,
  metodo_pago     varchar(40) default 'Efectivo',
  creado_en       timestamp default now(),
  actualizado_en  timestamp default now()
);

create index if not exists ix_pedidos_estado   on pedidos(estado);
create index if not exists ix_pedidos_entrega  on pedidos(fecha_entrega);

-- Trigger para mantener actualizado_en
create or replace function tg_set_actualizado_en()
returns trigger language plpgsql as $$
begin
  new.actualizado_en = now();
  return new;
end $$;

drop trigger if exists set_actualizado_en_pedidos on pedidos;
create trigger set_actualizado_en_pedidos
before update on pedidos
for each row execute function tg_set_actualizado_en();

-- ========== PARTIDAS (Ítems del pedido) ==========

create table if not exists partidas (
  id              serial primary key,
  pedido_id       int references pedidos(id) on delete cascade,
  producto        varchar(200) not null,
  descripcion     text,
  ancho_cm        numeric(10,2) default 0,
  alto_cm         numeric(10,2) default 0,
  cantidad        int not null default 1,
  info_color      varchar(120),
  acabados        varchar(200),
  precio_unitario numeric(12,2) not null default 0,
  subtotal        numeric(12,2) not null default 0
);

create index if not exists ix_partidas_pedido on partidas(pedido_id);

-- ========== BIBLIOTECA DE MEDIOS (EN BD) ==========

create table if not exists medios (
  id              bigserial primary key,
  huella_sha256   char(64) unique not null,     -- deduplicación por contenido
  nombre_archivo  varchar(255) not null,
  tipo_mime       varchar(120) not null,
  extension       varchar(12),
  bytes           bigint not null,
  ancho_px        int,                          -- si es imagen
  alto_px         int,
  datos           bytea not null,               -- BINARIO en BD
  origen          varchar(60) default 'upload',
  creado_en       timestamp default now()
);

create index if not exists ix_medios_sha on medios(huella_sha256);

create table if not exists etiquetas (
  id   serial primary key,
  etiqueta  varchar(64) unique not null
);

create table if not exists medios_etiquetas (
  medio_id   bigint references medios(id) on delete cascade,
  etiqueta_id int   references etiquetas(id) on delete cascade,
  primary key(medio_id, etiqueta_id)
);

create table if not exists usos_medio (
  id             bigserial primary key,
  medio_id       bigint not null references medios(id) on delete cascade,
  pedido_id      int references pedidos(id) on delete cascade,
  partida_id     int references partidas(id) on delete cascade,
  diseno_id      bigint,   -- FK se agrega tras crear diseños
  usado_como     tipo_uso_medio default 'otro',
  nota           varchar(200),
  creado_en      timestamp default now()
);

create index if not exists ix_usos_medio_medio  on usos_medio(medio_id);
create index if not exists ix_usos_medio_pedido on usos_medio(pedido_id, partida_id);

-- ========== DISEÑOS (VINCULADOS A PEDIDO/PARTIDA) ==========

create table if not exists disenos (
  id                bigserial primary key,
  pedido_id         int references pedidos(id) on delete cascade,
  partida_id        int references partidas(id) on delete cascade,
  titulo            varchar(200) not null default 'Diseño',
  nombre_plantilla  varchar(60),   -- "Camiseta", "Lona", etc.
  lienzo_ancho_px   int,
  lienzo_alto_px    int,
  modo_color        varchar(10),   -- "CMYK"/"RGB" (visual)
  sangrado_px       int,           -- 0, 20, 26… (visual)
  ajustes_json      jsonb,         -- estado del lienzo (guías, grilla…)
  svg_marcado       text,          -- opcional si guardas vectorial
  preview_medio_id  bigint references medios(id) on delete set null,
  estado            estado_diseno default 'borrador',
  creado_en         timestamp default now(),
  actualizado_en    timestamp default now()
);

create index if not exists ix_disenos_partida on disenos(partida_id);
create index if not exists ix_disenos_estado  on disenos(estado);

-- Relación N–M: diseños ↔ medios (referencias/recursos usados en el diseño)
create table if not exists diseno_medios (
  diseno_id bigint references disenos(id) on delete cascade,
  medio_id  bigint references medios(id)  on delete cascade,
  primary key(diseno_id, medio_id)
);

-- Completar FK de usos hacia diseños (si no existía)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_usos_medio_diseno'
      and table_name = 'usos_medio'
  ) then
    alter table usos_medio
      add constraint fk_usos_medio_diseno
      foreign key (diseno_id) references disenos(id) on delete cascade;
  end if;
end$$;

-- ========== VISTAS DE APOYO ==========

create or replace view v_resumen_pedidos as
select
  p.id, p.folio, p.estado, p.fecha_entrega, p.actualizado_en,
  coalesce(c.nombre, 'N/D') as cliente,
  p.total, p.anticipo
from pedidos p
left join clientes c on c.id = p.cliente_id;

create or replace view v_partidas_disenos as
select
  pa.id as partida_id, pa.pedido_id, pa.producto, pa.cantidad, pa.subtotal,
  count(d.id) as disenos
from partidas pa
left join disenos d on d.partida_id = pa.id
group by pa.id, pa.pedido_id, pa.producto, pa.cantidad, pa.subtotal;
