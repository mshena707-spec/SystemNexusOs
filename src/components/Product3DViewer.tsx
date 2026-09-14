import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stage, useGLTF, Center, Float } from '@react-three/drei';
import { X, Box } from 'lucide-react';
import { motion } from 'motion/react';

// A simple placeholder 3D model (a box) to represent the product
function PlaceholderModel({ color }: { color: string }) {
  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={color} roughness={0.3} metalness={0.2} />
      </mesh>
    </Float>
  );
}

function ProductModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

interface Product3DViewerProps {
  product: any;
  onClose: () => void;
}

export default function Product3DViewer({ product, onClose }: Product3DViewerProps) {
  // In a real app, we would load a specific GLTF model for each product
  // For now, we use a placeholder with a color based on the product category
  const getModelColor = (category: string) => {
    switch (category) {
      case 'Spices': return '#E67E22'; // Saffron/Orange
      case 'Herbs': return '#27AE60'; // Green
      default: return '#BDC3C7'; // Gray
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="bg-[#111] rounded-3xl shadow-2xl w-full max-w-4xl h-[80vh] overflow-hidden flex flex-col border border-[#333]"
      >
        <div className="p-4 border-b border-[#333] flex justify-between items-center bg-[#1a1a1a] text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
              <Box className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{product.name}</h2>
              <p className="text-xs text-gray-400">Interactive 3D View</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="flex-1 relative bg-gradient-to-b from-[#111] to-[#0a0a0a]">
          <Canvas shadows camera={{ position: [0, 0, 4], fov: 50 }}>
            <Suspense fallback={null}>
              <Stage environment="city" intensity={0.5}>
                <Center>
                  {product.modelUrl ? (
                    <ProductModel url={product.modelUrl} />
                  ) : (
                    <PlaceholderModel color={getModelColor(product.category)} />
                  )}
                </Center>
              </Stage>
              <OrbitControls autoRotate autoRotateSpeed={1} makeDefault minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 2} />
            </Suspense>
          </Canvas>
          
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/50 backdrop-blur-md px-6 py-3 rounded-full border border-white/10">
            <span className="text-white text-sm font-medium">Drag to rotate</span>
            <div className="w-1 h-1 bg-gray-500 rounded-full" />
            <span className="text-white text-sm font-medium">Scroll to zoom</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
