interface StatusIndicatorProps {
  name: string;
  isReady: boolean;
}

export function StatusIndicator({ name, isReady }: StatusIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      <div 
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: isReady ? '#22c55e' : '#ef4444' }}
      />
      <span className="text-sm text-muted-foreground">
        {name}
      </span>
    </div>
  );
}