import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Minus, Square, Maximize2 } from 'lucide-react';

export interface WindowState {
  id: string;
  title: string;
  component: React.ReactNode;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  x: number;
  y: number;
  width: number | string;
  height: number | string;
  zIndex: number;
}

interface WindowFrameProps {
  windowState: WindowState;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onMaximize: (id: string) => void;
  onFocus: (id: string) => void;
}

export const WindowFrame: React.FC<WindowFrameProps> = ({
  windowState,
  onClose,
  onMinimize,
  onMaximize,
  onFocus
}) => {
  if (!windowState.isOpen || windowState.isMinimized) return null;

  return (
    <motion.div
      drag={!windowState.isMaximized}
      dragMomentum={false}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ 
        opacity: 1, 
        scale: 1,
        x: windowState.isMaximized ? 0 : windowState.x,
        y: windowState.isMaximized ? 0 : windowState.y,
        width: windowState.isMaximized ? '100%' : windowState.width,
        height: windowState.isMaximized ? '100%' : windowState.height
      }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      onPointerDown={() => onFocus(windowState.id)}
      className="absolute bg-white/90 backdrop-blur-md rounded-lg shadow-2xl border border-gray-200/50 overflow-hidden flex flex-col"
      style={{ 
        zIndex: windowState.zIndex,
        top: windowState.isMaximized ? 0 : undefined,
        left: windowState.isMaximized ? 0 : undefined,
      }}
    >
      {/* Titlebar */}
      <div 
        className="window-titlebar bg-gray-100/80 px-3 py-2 flex justify-between items-center cursor-move select-none border-b border-gray-200/50"
        onDoubleClick={() => onMaximize(windowState.id)}
      >
        <span className="text-xs font-semibold text-nexus-text-faint">{windowState.title}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => onMinimize(windowState.id)} className="text-nexus-text-muted hover:text-nexus-text-faint transition-colors">
            <Minus size={14} />
          </button>
          <button onClick={() => onMaximize(windowState.id)} className="text-nexus-text-muted hover:text-nexus-text-faint transition-colors">
            <Square size={12} />
          </button>
          <button onClick={() => onClose(windowState.id)} className="text-nexus-text-muted hover:text-red-500 transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-gray-50/50 relative">
        {windowState.component}
      </div>
    </motion.div>
  );
};
