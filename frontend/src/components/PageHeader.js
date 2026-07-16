export const PageHeader = ({ eyebrow, title, children }) => (
  <div className="flex items-end justify-between border-b border-zinc-800 px-8 py-6 sticky top-0 bg-background/90 backdrop-blur z-10">
    <div>
      <div className="label-eyebrow">{eyebrow}</div>
      <h1 className="font-display font-extrabold text-3xl tracking-tight mt-1">{title}</h1>
    </div>
    <div className="flex items-center gap-3">{children}</div>
  </div>
);
