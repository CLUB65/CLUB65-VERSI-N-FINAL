import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface LeafletMapProps {
  lat: number;
  lng: number;
  title?: string;
  locationName?: string;
  className?: string;
  height?: string | number;
  zoom?: number;
}

export const LeafletMap: React.FC<LeafletMapProps> = ({
  lat,
  lng,
  title,
  locationName,
  className = '',
  height = '260px',
  zoom = 15
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // Default fallback coords (Caseros / Tres de Febrero, Buenos Aires, Argentina: -34.6068, -58.5647)
  const safeLat = typeof lat === 'number' && !isNaN(lat) && lat !== 0 ? lat : -34.6068;
  const safeLng = typeof lng === 'number' && !isNaN(lng) && lng !== 0 ? lng : -58.5647;

  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up if already exists
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Initialize Map
    const map = L.map(containerRef.current, {
      center: [safeLat, safeLng],
      zoom: zoom,
      zoomControl: true,
      scrollWheelZoom: false
    });

    // Add OpenStreetMap tile layer (100% free, no API key needed)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
    }).addTo(map);

    // Custom marker icon matching CLUB65 styling
    const customIcon = L.divIcon({
      className: 'custom-leaflet-marker',
      html: `
        <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; width: 34px; height: 34px; background: #F26A2E; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); box-shadow: 0 4px 10px rgba(0,0,0,0.35); border: 2.5px solid #FFFFFF;"></div>
          <i class="fa-solid fa-location-dot" style="position: relative; color: #FFFFFF; font-size: 16px; margin-top: -4px;"></i>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -32]
    });

    const marker = L.marker([safeLat, safeLng], { icon: customIcon }).addTo(map);
    markerRef.current = marker;

    if (title || locationName) {
      marker.bindPopup(`
        <div style="font-family: inherit; font-size: 12px; line-height: 1.4; padding: 4px 2px;">
          ${title ? `<strong style="display:block; color: #5A2B1B; font-size: 13px; margin-bottom: 3px;">${escapeHtml(title)}</strong>` : ''}
          ${locationName ? `<span style="color: #666;">${escapeHtml(locationName)}</span>` : ''}
        </div>
      `);
    }

    mapInstanceRef.current = map;

    // Trigger invalidateSize after slight delay to ensure correct tile rendering in modals
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [safeLat, safeLng, zoom, title, locationName]);

  return (
    <div
      ref={containerRef}
      className={`w-full rounded-2xl overflow-hidden relative shadow-inner ${className}`}
      style={{ height, minHeight: typeof height === 'number' ? `${height}px` : height, zIndex: 1 }}
    />
  );
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default LeafletMap;
