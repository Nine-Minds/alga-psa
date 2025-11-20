'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { IProject } from '@/interfaces/project.interfaces';
import { useToast } from '@/hooks/use-toast';

export default function CreateTemplatePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [projects, setProjects] = useState<IProject[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    project_id: '',
    template_name: '',
    description: '',
    category: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [projectsRes, categoriesRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/projects/templates/categories')
      ]);

      if (!projectsRes.ok || !categoriesRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const projectsData = await projectsRes.json();
      const categoriesData = await categoriesRes.json();

      setProjects(projectsData);
      setCategories(categoriesData);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load data',
        variant: 'destructive'
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.project_id || !formData.template_name) {
      toast({
        title: 'Validation Error',
        description: 'Project and template name are required',
        variant: 'destructive'
      });
      return;
    }

    try {
      setLoading(true);

      const response = await fetch('/api/projects/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          project_id: formData.project_id,
          template_name: formData.template_name,
          description: formData.description || undefined,
          category: formData.category || undefined
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create template');
      }

      const { template_id } = await response.json();

      toast({
        title: 'Success',
        description: 'Template created successfully'
      });

      router.push(`/msp/projects/templates/${template_id}`);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create template',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create Template from Project</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Source Project *
          </label>
          <CustomSelect
            id="source-project"
            value={formData.project_id}
            onValueChange={(value) => setFormData({ ...formData, project_id: value })}
            options={projects.map(p => ({
              value: p.project_id,
              label: `${p.project_name} (${p.wbs_code})`
            }))}
            placeholder="Select a project"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Template Name *
          </label>
          <Input
            id="template-name"
            value={formData.template_name}
            onChange={(e) => setFormData({ ...formData, template_name: e.target.value })}
            placeholder="Enter template name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Description
          </label>
          <Textarea
            id="template-description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Enter template description"
            rows={4}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Category
          </label>
          <Input
            id="template-category"
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            placeholder="e.g., Software Development, Network Setup"
            list="category-suggestions"
          />
          <datalist id="category-suggestions">
            {categories.map(cat => (
              <option key={cat} value={cat} />
            ))}
          </datalist>
        </div>

        <div className="flex gap-4">
          <Button
            id="create-template-submit"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Creating...' : 'Create Template'}
          </Button>
          <Button
            id="cancel-create-template"
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
