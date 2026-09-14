import React from 'react';

interface ProductVideoProps {
    src?: string;
    poster?: string;
}

export const ProductVideo: React.FC<ProductVideoProps> = ({ 
    src = "https://www.w3schools.com/html/mov_bbb.mp4", 
    poster 
}) => {
    return (
        <div className="relative w-full rounded-xl overflow-hidden shadow-lg bg-black/10">
            <video 
                src={src} 
                poster={poster}
                autoPlay 
                muted 
                loop 
                playsInline
                className="w-full h-full object-cover max-h-[400px]"
            />
            {/* Phase 151: Auto play fast conversion UI overlay */}
            <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-1 rounded-md text-xs text-white flex items-center gap-1 border border-white/10">
                <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                Live Preview
            </div>
        </div>
    );
};
