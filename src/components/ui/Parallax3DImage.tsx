import React, { useRef, useState, useEffect } from 'react';

/**
 * PHASE 6: 3D IMAGE EXPERIENCE ENGINE (Parallax/Pseudo-3D)
 */
export function Parallax3DImage({ src, alt, className = "" }: { src: string, alt: string, className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left; // x position within the element.
    const y = e.clientY - rect.top;  // y position within the element.
    
    // Calculate rotation limits (e.g., max 15 degrees)
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const rotateX = ((y - centerY) / centerY) * -15;
    const rotateY = ((x - centerX) / centerX) * 15;

    setRotation({ x: rotateX, y: rotateY });
  };

  const handleMouseEnter = () => setIsHovering(true);
  const handleMouseLeave = () => {
    setIsHovering(false);
    setRotation({ x: 0, y: 0 }); // Reset on leave
  };

  return (
    <div 
      ref={containerRef}
      className={`relative perspective-1000 ${className}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ perspective: '1000px' }}
    >
      <div 
        className="w-full h-full transition-transform duration-200 ease-out"
        style={{
          transform: isHovering 
            ? `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) scale3d(1.05, 1.05, 1.05)`
            : 'rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
          transformStyle: 'preserve-3d'
        }}
      >
        <img 
          src={src} 
          alt={alt} 
          className="w-full h-full object-cover rounded-xl shadow-2xl"
          style={{ transform: 'translateZ(50px)' }}
        />
        {/* Adds a pseudo-depth/lighting illusion */}
        {isHovering && (
          <div 
            className="absolute inset-0 rounded-xl"
            style={{
              background: `radial-gradient(circle at ${50 + rotation.y * 3}% ${50 - rotation.x * 3}%, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 60%)`,
              transform: 'translateZ(60px)'
            }}
          />
        )}
      </div>
    </div>
  );
}
