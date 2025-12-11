import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface GenerationStep {
  id: string;
  label: string;
  sublabel?: string;
  status: "pending" | "active" | "completed";
}

interface ProcessingModalProps {
  isOpen: boolean;
  onClose: () => void;
  steps: GenerationStep[];
}

export function ProcessingModal({ isOpen, onClose, steps }: ProcessingModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <DialogTitle className="text-2xl font-bold">
              Generating Project...
            </DialogTitle>
          </div>
          <p className="text-muted-foreground pt-1">
            Please wait while we process your request.
          </p>
        </DialogHeader>

        <div className="py-6 space-y-4">
          {steps.map((step) => (
            <div key={step.id} className="flex items-start gap-3">
              {step.status === "completed" ? (
                <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0 mt-0.5" />
              ) : step.status === "active" ? (
                <div className="w-6 h-6 shrink-0 mt-0.5">
                  <Circle className="w-6 h-6 text-primary animate-pulse" strokeWidth={2} />
                </div>
              ) : (
                <Circle className="w-6 h-6 text-muted-foreground/40 shrink-0 mt-0.5" strokeWidth={1.5} />
              )}
              <div>
                <p className={`font-medium ${
                  step.status === "active" 
                    ? "text-primary" 
                    : step.status === "completed" 
                      ? "text-foreground" 
                      : "text-muted-foreground"
                }`}>
                  {step.label}
                </p>
                {step.sublabel && step.status === "active" && (
                  <p className="text-sm text-muted-foreground">
                    {step.sublabel}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}