'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent, CardTitle, CardFooter } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from 'server/src/components/ui/Table';
import { PlusCircle, Trash2 } from 'lucide-react';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { IServiceRateTier } from 'server/src/interfaces/serviceTier.interfaces';
import { getServiceRateTiers, updateServiceRateTiers } from '@product/actions/serviceRateTierActions';

// Define the rate tier interface
interface RateTier {
  id: string;
  minQuantity: number;
  maxQuantity: number | null;
  rate: number;
  isNew?: boolean;
}

interface ServiceRateTiersProps {
  service: IService;
  onUpdate?: () => void;
}

export function ServiceRateTiers({ service, onUpdate }: ServiceRateTiersProps) {
  const [tiers, setTiers] = useState<RateTier[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load existing tiers from the database
  useEffect(() => {
    const fetchTiers = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        const serviceTiers = await getServiceRateTiers(service.service_id);
        
        if (serviceTiers.length > 0) {
          // Convert from IServiceRateTier to RateTier format
          const formattedTiers = serviceTiers.map(tier => ({
            id: tier.tier_id,
            minQuantity: tier.min_quantity,
            maxQuantity: tier.max_quantity,
            rate: tier.rate
          }));
          
          setTiers(formattedTiers);
        } else {
          // Initialize with a default tier based on service default_rate
          setTiers([
            {
              id: `tier-${Date.now()}`,
              minQuantity: 1,
              maxQuantity: null,
              rate: service.default_rate,
              isNew: true
            }
          ]);
        }
      } catch (err) {
        console.error('Error loading service rate tiers:', err);
        setError('Failed to load rate tiers');
        
        // Set default tier on error
        setTiers([
          {
            id: `tier-${Date.now()}`,
            minQuantity: 1,
            maxQuantity: null,
            rate: service.default_rate,
            isNew: true
          }
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTiers();
  }, [service.service_id, service.default_rate]);

  const addTier = () => {
    // Find the highest max quantity to set as the new min quantity
    const highestMax = tiers.reduce((max, tier) => {
      if (tier.maxQuantity !== null && tier.maxQuantity > max) {
        return tier.maxQuantity;
      }
      return max;
    }, 0);

    const newMinQuantity = highestMax > 0 ? highestMax + 1 : 1;
    
    // Create a new tier with a 5% discount from the previous tier
    const previousRate = tiers.length > 0 ? tiers[tiers.length - 1].rate : service.default_rate;
    const discountedRate = Math.round(previousRate * 0.95 * 100) / 100; // 5% discount, rounded to 2 decimal places

    const newTier: RateTier = {
      id: `tier-${Date.now()}`,
      minQuantity: newMinQuantity,
      maxQuantity: null,
      rate: discountedRate,
      isNew: true
    };

    // If there's an existing tier with null maxQuantity, update it
    const updatedTiers = [...tiers];
    const unlimitedTierIndex = updatedTiers.findIndex(tier => tier.maxQuantity === null);
    
    if (unlimitedTierIndex !== -1) {
      updatedTiers[unlimitedTierIndex] = {
        ...updatedTiers[unlimitedTierIndex],
        maxQuantity: newMinQuantity - 1
      };
    }

    setTiers([...updatedTiers, newTier]);
  };

  const removeTier = (id: string) => {
    // Don't allow removing the last tier
    if (tiers.length <= 1) {
      setError("Cannot remove the last tier");
      return;
    }

    const tierIndex = tiers.findIndex(tier => tier.id === id);
    if (tierIndex === -1) return;

    const updatedTiers = [...tiers];
    
    // If removing a tier that's not the last one, update the next tier's minQuantity
    if (tierIndex < tiers.length - 1) {
      const currentTier = tiers[tierIndex];
      const nextTier = updatedTiers[tierIndex + 1];
      
      updatedTiers[tierIndex + 1] = {
        ...nextTier,
        minQuantity: currentTier.minQuantity
      };
    }
    
    // If removing a tier that's not the first one, update the previous tier's maxQuantity
    if (tierIndex > 0) {
      const currentTier = tiers[tierIndex];
      const prevTier = updatedTiers[tierIndex - 1];
      
      updatedTiers[tierIndex - 1] = {
        ...prevTier,
        maxQuantity: currentTier.maxQuantity
      };
    }
    
    setTiers(updatedTiers.filter(tier => tier.id !== id));
  };

  const updateTierField = (id: string, field: keyof RateTier, value: any) => {
    const updatedTiers = tiers.map(tier => {
      if (tier.id === id) {
        return { ...tier, [field]: value };
      }
      return tier;
    });
    
    // Sort tiers by minQuantity to maintain order
    updatedTiers.sort((a, b) => a.minQuantity - b.minQuantity);
    
    setTiers(updatedTiers);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);

      // Validate tiers
      for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];
        
        if (tier.minQuantity <= 0) {
          setError("Minimum quantity must be greater than 0");
          setIsSaving(false);
          return;
        }
        
        if (tier.maxQuantity !== null && tier.maxQuantity <= tier.minQuantity) {
          setError("Maximum quantity must be greater than minimum quantity");
          setIsSaving(false);
          return;
        }
        
        if (tier.rate < 0) {
          setError("Rate cannot be negative");
          setIsSaving(false);
          return;
        }
        
        // Check for overlapping ranges
        for (let j = 0; j < tiers.length; j++) {
          if (i !== j) {
            const otherTier = tiers[j];
            
            const thisMin = tier.minQuantity;
            const thisMax = tier.maxQuantity === null ? Infinity : tier.maxQuantity;
            const otherMin = otherTier.minQuantity;
            const otherMax = otherTier.maxQuantity === null ? Infinity : otherTier.maxQuantity;
            
            if ((thisMin <= otherMax && thisMax >= otherMin) ||
                (otherMin <= thisMax && otherMax >= thisMin)) {
              setError("Tier ranges cannot overlap");
              setIsSaving(false);
              return;
            }
          }
        }
      }

      // Convert tiers to the format expected by the API
      const tierData = tiers.map(tier => ({
        min_quantity: tier.minQuantity,
        max_quantity: tier.maxQuantity,
        rate: tier.rate
      }));

      // Save tiers to the database
      await updateServiceRateTiers(service.service_id, tierData);
      
      // Mark all tiers as not new
      setTiers(tiers.map(tier => ({ ...tier, isNew: false })));

      if (onUpdate) {
        onUpdate();
      }
      
      // Show success message
      setError(null);
    } catch (err) {
      console.error('Error saving rate tiers:', err);
      setError('Failed to save rate tiers');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Rate Tiers & Quantity Discounts</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">Loading rate tiers...</p>
          </div>
        ) : (
          <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Configure different rates based on quantity ranges. Higher quantities can have discounted rates.
          </p>
          
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Min Quantity</TableHead>
                <TableHead>Max Quantity</TableHead>
                <TableHead>Rate (${service.unit_of_measure})</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((tier) => (
                <TableRow key={tier.id} className={tier.isNew ? "bg-blue-50" : ""}>
                  <TableCell>
                    <Input
                      id={`min-quantity-${tier.id}`}
                      type="number"
                      value={tier.minQuantity}
                      onChange={(e) => updateTierField(tier.id, 'minQuantity', parseInt(e.target.value) || 0)}
                      min={1}
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      id={`max-quantity-${tier.id}`}
                      type="number"
                      value={tier.maxQuantity === null ? '' : tier.maxQuantity}
                      onChange={(e) => {
                        const value = e.target.value === '' ? null : parseInt(e.target.value);
                        updateTierField(tier.id, 'maxQuantity', value);
                      }}
                      min={tier.minQuantity + 1}
                      placeholder="Unlimited"
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      id={`rate-${tier.id}`}
                      type="number"
                      value={tier.rate}
                      onChange={(e) => updateTierField(tier.id, 'rate', parseFloat(e.target.value) || 0)}
                      min={0}
                      step={0.01}
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      id={`remove-tier-${tier.id}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => removeTier(tier.id)}
                      disabled={tiers.length <= 1}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          <div className="flex justify-start">
            <Button
              id="add-tier-button"
              variant="outline"
              size="sm"
              onClick={addTier}
              className="flex items-center gap-1"
            >
              <PlusCircle className="h-4 w-4" />
              Add Tier
            </Button>
          </div>
          
          {error && <p className="text-red-500 text-sm">{error}</p>}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button 
          id="save-rate-tiers-button"
          onClick={handleSave} 
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Rate Tiers'}
        </Button>
      </CardFooter>
    </Card>
  );
}