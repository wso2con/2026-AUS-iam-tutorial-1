import { Link } from "react-router-dom";
import wayfinderLogo from "../assets/wayfinder-logo.png";

export function Header() {
  return (
    <header className="site-header">
      <Link className="brand" to="/flights" aria-label="Wayfinder Travel home">
        <span className="brand-mark">
          <img className="brand-logo" src={wayfinderLogo} alt="Wayfinder Travel logo" />
        </span>
        <span>Wayfinder</span>
      </Link>

      <nav className="header-nav" aria-label="Primary navigation">
        <a href="/flights#search">Search</a>
        <a href="/flights#deals">Deals</a>
        <a href="/flights#faq">FAQ</a>
      </nav>

    </header>
  );
}
