export default function App() {
  return (
    <div className="portal-shell">
      <header className="portal-header">
        <a className="brand" href="/" aria-label="Hivarium Customer Portal home">
          <span className="brand-mark" aria-hidden="true">H</span>
          <span>
            <strong>Hivarium</strong>
            <small>Customer Portal</small>
          </span>
        </a>
      </header>

      <main className="portal-main">
        <p className="eyebrow">Customer workspace foundation</p>
        <h1>Your Hivarium relationship, in one place.</h1>
        <p className="lede">
          The secure portal for subscription details, agent access, license status,
          usage, and service requests is being prepared.
        </p>
        <section className="status-card" aria-labelledby="foundation-status">
          <div>
            <p className="card-label">Environment</p>
            <h2 id="foundation-status">Foundation ready</h2>
          </div>
          <span className="status-pill">Private preview</span>
        </section>
      </main>
    </div>
  );
}
