"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@alga-psa/ui/components/Dialog";
import { Button } from "@alga-psa/ui/components/Button";
import { Label } from "@alga-psa/ui/components/Label";
import { Input } from "@alga-psa/ui/components/Input";
import { TextArea } from "@alga-psa/ui/components/TextArea";
import { createWorkflowFromTemplate } from "server/src/lib/actions/template-library-actions";
import { toast } from "react-hot-toast";
import { useRouter } from "next/navigation";
import { Code2 } from "lucide-react";
import Editor from "@monaco-editor/react";

import { TemplateData } from "server/src/lib/actions/template-library-actions";
import { extractTemplateCode } from "server/src/lib/utils/templateUtils";

interface TemplatePreviewProps {
  isOpen: boolean;
  onClose: () => void;
  template: TemplateData | null;
  mode: "preview" | "create";
}

export default function TemplatePreview({ isOpen, onClose, template, mode }: TemplatePreviewProps) {
  const router = useRouter();
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Reset form when template changes
  React.useEffect(() => {
    if (template) {
      setWorkflowName(template.name);
      setWorkflowDescription(template.description || "");
    }
  }, [template]);

  const handleCreateWorkflow = async () => {
    if (!template) return;
    
    if (!workflowName.trim()) {
      toast.error("Workflow name is required");
      return;
    }
    
    setIsCreating(true);
    try {
      const workflowId = await createWorkflowFromTemplate(
        template.template_id,
        workflowName,
        workflowDescription
      );
      
      toast.success("Workflow created successfully");
      onClose();
      router.push(`/msp/automation-hub?tab=workflows&workflowId=${workflowId}`);
    } catch (error) {
      console.error("Error creating workflow from template:", error);
      toast.error("Failed to create workflow from template");
    } finally {
      setIsCreating(false);
    }
  };

  if (!template) return null;

  // Get template code for preview
  const getTemplateCode = () => {
    if (!template) return "// No template selected";
    return extractTemplateCode(template.definition);
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} id="template-preview-dialog">
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center" id="template-preview-title">
              <Code2 className="h-5 w-5 mr-2 text-primary-500" />
              {mode === "preview" ? "Template Preview" : "Create Workflow from Template"}
            </div>
            
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 my-4">
          {mode === "create" && (
            <>
              <div>
                <Label htmlFor="workflow-name">Workflow Name</Label>
                <Input
                  id="workflow-name"
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  placeholder="Enter workflow name"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="workflow-description">Description</Label>
                <TextArea
                  id="workflow-description"
                  value={workflowDescription}
                  onChange={(e) => setWorkflowDescription(e.target.value)}
                  placeholder="Enter workflow description"
                  className="mt-1"
                  rows={3}
                />
              </div>
            </>
          )}
          
          <div>
            <Label>Template Information</Label>
            <div className="mt-1 p-4 bg-gray-50 rounded-md">
              <h3 className="font-medium">{template.name}</h3>
              <p className="text-sm text-gray-600 mt-1">{template.description}</p>
              
              {template.category && (
                <div className="mt-2">
                  <span className="text-xs font-medium bg-primary-100 text-primary-800 rounded-full px-2 py-1">
                    {template.category}
                  </span>
                </div>
              )}
              
              {template.tags && template.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {template.tags.map((tag) => (
                    <span key={tag} className="text-xs bg-gray-100 text-gray-800 rounded-full px-2 py-0.5">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          <div>
            <Label>Template Code Preview</Label>
            <div className="mt-1 rounded-md overflow-hidden border border-gray-200" style={{ height: "300px" }}>
              <Editor
                height="100%"
                defaultLanguage="typescript"
                value={getTemplateCode()}
                options={{
                  readOnly: true,
                  minimap: { enabled: true },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: "on",
                  wrappingIndent: "indent",
                  scrollbar: {
                    vertical: "auto",
                    horizontal: "auto",
                    verticalScrollbarSize: 12,
                    horizontalScrollbarSize: 12
                  }
                }}
              />
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <Button id="cancel-preview-button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {mode === "create" && (
            <Button id="create-workflow-button" onClick={handleCreateWorkflow} disabled={isCreating}>
              {isCreating ? "Creating..." : "Create Workflow"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}