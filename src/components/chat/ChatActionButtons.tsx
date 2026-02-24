import { motion } from 'framer-motion';
import { Phone, MessageSquare } from 'lucide-react';

interface ChatActionButtonsProps {
  onCall: () => void;
  onMessage: () => void;
}

export function ChatActionButtons({ onCall, onMessage }: ChatActionButtonsProps) {
  const buttons = [
    {
      id: 'call',
      label: "Let's Call!",
      icon: Phone,
      onClick: onCall,
    },
    {
      id: 'message',
      label: "Let's Message Here",
      icon: MessageSquare,
      onClick: onMessage,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="flex flex-wrap items-center gap-3 px-4 md:px-6 py-2"
    >
      {buttons.map((button, index) => {
        const Icon = button.icon;
        return (
          <motion.button
            key={button.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 + index * 0.1 }}
            onClick={button.onClick}
            className="flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-full bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] hover:border-accent transition-all duration-200 text-sm font-medium"
          >
            <Icon size={18} />
            <span>{button.label}</span>
          </motion.button>
        );
      })}
    </motion.div>
  );
}
