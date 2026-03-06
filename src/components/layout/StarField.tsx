// Stars are now drawn by SpaceBackground canvas at z-index -1.
// This component only renders the film grain overlay.
export default function StarField() {
  return <div className="film-grain-overlay" aria-hidden="true" />;
}