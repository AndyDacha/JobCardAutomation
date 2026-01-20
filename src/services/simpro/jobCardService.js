import axios from 'axios';
import config from '../../config/index.js';
import logger from '../../utils/logger.js';

const { baseUrl, apiKey, companyId } = config.simpro;

// Validate configuration
if (!baseUrl || baseUrl === '') {
  logger.error('SIMPRO_BASE_URL is not set in environment variables');
}
if (!apiKey || apiKey === '') {
  logger.error('SIMPRO_API_KEY is not set in environment variables');
}
if (!companyId || companyId === '') {
  logger.error('SIMPRO_COMPANY_ID is not set in environment variables');
}

logger.info(`Simpro config - Base URL: ${baseUrl ? baseUrl.replace(/\/[^\/]*$/, '/***') : 'NOT SET'}, Company ID: ${companyId || 'NOT SET'}`);

const axiosInstance = axios.create({
  baseURL: baseUrl,
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

// Rate limiting helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      logger.debug(`API Request: GET ${baseUrl}${url}`);
      const response = await axiosInstance.get(url);
      logger.debug(`API Response: Status ${response.status} for ${url}`);
      return response.data;
    } catch (error) {
      if (error.response) {
        logger.error(`API Error (attempt ${i + 1}/${maxRetries}): ${error.response.status} ${error.response.statusText} for ${baseUrl}${url}`);
        if (error.response.data) {
          logger.error(`Error response data: ${JSON.stringify(error.response.data, null, 2)}`);
        }
      } else {
        logger.error(`Network error (attempt ${i + 1}/${maxRetries}): ${error.message} for ${baseUrl}${url}`);
      }
      if (i === maxRetries - 1) throw error;
      await delay(1000 * (i + 1));
    }
  }
}

function stripHtmlToText(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  return String(text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parseAssetsFromText(text) {
  const cleaned = decodeHtmlEntities(stripHtmlToText(text));
  const assets = [];

  // Example pattern observed in Simpro description:
  // "Asset Type DualCom Digiair Pro3 - Service Level Annual - Quantity 1"
  const re = /Asset Type\s+(.+?)\s*-\s*Service Level\s+(.+?)\s*-\s*Quantity\s+(\d+)/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    assets.push({
      assetType: (m[1] || '').trim(),
      serviceLevel: (m[2] || '').trim(),
      quantity: Number(m[3])
    });
  }

  const firstIdx = cleaned.toLowerCase().indexOf('asset type');
  const prefix = firstIdx > 0 ? cleaned.slice(0, firstIdx).trim() : '';

  return { assets, prefix, cleaned };
}

function parseWorkCarriedOutFromText(text) {
  const cleaned = decodeHtmlEntities(stripHtmlToText(text));
  if (!cleaned) return { diagnostics: '', actionsTaken: '', results: '', workNotes: '' };

  // Try structured parsing if present
  const diagnosticsMatch = cleaned.match(/Diagnostics[:\s]*(.*?)(?:Actions Taken|Results|$)/is);
  const actionsMatch = cleaned.match(/Actions Taken[:\s]*(.*?)(?:Results|$)/is);
  const resultsMatch = cleaned.match(/Results[:\s]*(.*?)$/is);

  const diagnostics = diagnosticsMatch ? diagnosticsMatch[1].trim() : '';
  const actionsTaken = actionsMatch ? actionsMatch[1].trim() : '';
  const results = resultsMatch ? resultsMatch[1].trim() : '';

  return {
    diagnostics,
    actionsTaken,
    results,
    workNotes: cleaned
  };
}

function extractEngineers(sections) {
  const engineersMap = new Map(); // Use Map to deduplicate by ID
  
  sections?.forEach(section => {
    section.costCenters?.forEach(cc => {
      cc.schedules?.forEach(schedule => {
        // Check schedule Staff
        const staffId = schedule.Staff?.ID || schedule.StaffID || schedule.StaffId;
        const staffName = schedule.Staff?.Name || schedule.StaffName;
        
        if (staffId && !engineersMap.has(staffId)) {
          engineersMap.set(staffId, {
            name: staffName?.trim() || `Engineer ${staffId}`,
            id: staffId
          });
        }
        
        // Also check work orders for engineers
        if (schedule.workOrders && Array.isArray(schedule.workOrders)) {
          schedule.workOrders.forEach(wo => {
            const woStaffId = wo.Staff?.ID || wo.StaffID || wo.StaffId || wo.Technician?.ID || wo.TechnicianID;
            const woStaffName = wo.Staff?.Name || wo.StaffName || wo.Technician?.Name || wo.TechnicianName;
            
            if (woStaffId && !engineersMap.has(woStaffId)) {
              engineersMap.set(woStaffId, {
                name: woStaffName?.trim() || `Engineer ${woStaffId}`,
                id: woStaffId
              });
            }
          });
        }
      });
    });
  });
  
  return Array.from(engineersMap.values());
}

function extractValidLabour(sections) {
  const labour = [];
  logger.info(`[DEBUG] extractValidLabour: Processing ${sections?.length || 0} sections`);
  
  sections?.forEach((section, sectionIdx) => {
    logger.debug(`[DEBUG] extractValidLabour: Section ${sectionIdx}, has costCenters: ${!!section.costCenters}, count: ${section.costCenters?.length || 0}`);
    
    section.costCenters?.forEach((cc, ccIdx) => {
      logger.debug(`[DEBUG] extractValidLabour: CostCenter ${ccIdx}, has schedules: ${!!cc.schedules}, count: ${cc.schedules?.length || 0}`);
      
      cc.schedules?.forEach((schedule, schedIdx) => {
        // Log the full schedule structure to see what fields are available
        logger.info(`[DEBUG] extractValidLabour: Schedule ${schedIdx} keys:`, Object.keys(schedule));
        
        // According to Simpro API, schedules have a "Blocks" array with time entries
        // Each block has StartTime, EndTime, and the schedule has Date and Staff
        const scheduleDate = schedule.Date || schedule.WorkDate || schedule.ScheduledDate || schedule.StartDate;
        const staffId = schedule.Staff?.ID || schedule.StaffID || schedule.StaffId || schedule.Technician?.ID || schedule.TechnicianID;
        const staffName = schedule.Staff?.Name || schedule.StaffName || schedule.Technician?.Name;
        
        // Check for Blocks array first (this is the correct way per Simpro API)
        if (schedule.Blocks && Array.isArray(schedule.Blocks) && schedule.Blocks.length > 0) {
          logger.info(`[DEBUG] Found ${schedule.Blocks.length} blocks in schedule ${schedIdx}`);
          
          schedule.Blocks.forEach((block, blockIdx) => {
            const blockStartTime = block.StartTime || block.Start || block.StartDateTime;
            const blockEndTime = block.EndTime || block.End || block.EndDateTime || block.FinishTime;
            
            if (blockStartTime && blockEndTime && staffId && scheduleDate) {
              try {
                // Parse time strings (format: "HH:MM" or "HH:MM:SS")
                const parseTime = (timeStr, dateStr) => {
                  const [hours, minutes] = timeStr.split(':').map(Number);
                  const date = new Date(dateStr);
                  date.setHours(hours, minutes || 0, 0, 0);
                  return date;
                };
                
                const start = parseTime(blockStartTime, scheduleDate);
                const end = parseTime(blockEndTime, scheduleDate);
                
                // If end time is before start time, it's likely the next day
                if (end < start) {
                  end.setDate(end.getDate() + 1);
                }
                
                if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                  const hours = ((end - start) / (1000 * 60 * 60)).toFixed(2);
                  const formattedDate = start.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                  const formattedStartTime = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
                  const formattedEndTime = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
                  
                  labour.push({
                    date: formattedDate,
                    engineer: `Dacha SSI Engineer (${staffId})`,
                    startTime: formattedStartTime,
                    endTime: formattedEndTime,
                    hours: hours
                  });
                  logger.info(`[DEBUG] Added labour entry from block ${blockIdx}: ${formattedDate} ${formattedStartTime}-${formattedEndTime} ${hours}h`);
                }
              } catch (error) {
                logger.warn(`Error parsing block times: ${error.message}`);
              }
            }
          });
        }
        
        // Fallback: Try schedule-level fields if no Blocks array
        const startTime = schedule.StartTime || schedule.ScheduledStartTime || schedule.Start || schedule.StartDateTime || 
                         schedule.StartDate || schedule.ScheduledStart || schedule.ActualStartTime;
        const endTime = schedule.EndTime || schedule.ScheduledEndTime || schedule.End || schedule.EndDateTime || 
                       schedule.EndDate || schedule.ScheduledEnd || schedule.ActualEndTime || schedule.FinishTime;
        
        // Also check if there's a Duration field we can use (NormalTime, Total, Hours, etc.)
        const duration = schedule.NormalTime || schedule.Total || schedule.Duration || schedule.Hours || schedule.TotalHours || schedule.HoursWorked;
        
        logger.debug(`[DEBUG] extractValidLabour: Schedule ${schedIdx} - date: ${scheduleDate}, startTime: ${startTime}, endTime: ${endTime}, staffId: ${staffId}, staffName: ${staffName}, duration: ${duration}`);
        
        // Try to create labour entry - prioritize having all data, but be flexible
        if (staffId) {
          try {
            let formattedDate = '';
            let formattedStartTime = '';
            let formattedEndTime = '';
            let hours = '0.00';
            
            // Get date - use Date field first, then try to extract from startTime
            if (scheduleDate) {
              const date = new Date(scheduleDate);
              if (!isNaN(date.getTime())) {
                formattedDate = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
              }
            }
            
            // If we have startTime and endTime, use them to calculate hours
            if (startTime && endTime) {
              const start = new Date(startTime);
              const end = new Date(endTime);
              if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                if (!formattedDate) {
                  formattedDate = start.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                }
                formattedStartTime = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
                formattedEndTime = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
                hours = ((end - start) / (1000 * 60 * 60)).toFixed(2);
              }
            } else if (duration) {
              // Use duration if available
              hours = parseFloat(duration).toFixed(2);
              
              // Try to format times if available
              if (startTime) {
                try {
                  const start = new Date(startTime);
                  if (!isNaN(start.getTime())) {
                    formattedStartTime = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
                    if (!formattedDate) {
                      formattedDate = start.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    }
                  }
                } catch (e) {}
              }
              if (endTime) {
                try {
                  const end = new Date(endTime);
                  if (!isNaN(end.getTime())) {
                    formattedEndTime = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
                  }
                } catch (e) {}
              }
            }
            
            // If we still don't have a date, use today
            if (!formattedDate) {
              formattedDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
            }
            
            // Only add if we have at least a date and staff ID
            if (formattedDate && staffId) {
              labour.push({
                date: formattedDate,
                engineer: `Dacha SSI Engineer (${staffId})`,
                startTime: formattedStartTime,
                endTime: formattedEndTime,
                hours: hours
              });
              logger.info(`[DEBUG] Added labour entry: ${formattedDate} ${formattedStartTime}-${formattedEndTime} ${hours}h (Staff: ${staffId} ${staffName || ''})`);
            }
          } catch (error) {
            logger.warn(`Error creating labour entry for schedule ${schedIdx}: ${error.message}`);
          }
        } else {
          logger.debug(`[DEBUG] Skipping schedule ${schedIdx} - no staffId found`);
        }
        
        // Also check work orders for labour entries
        if (schedule.workOrders && Array.isArray(schedule.workOrders)) {
          schedule.workOrders.forEach((wo, woIdx) => {
            const woStartTime = wo.StartTime || wo.ScheduledStartTime || wo.Start || wo.StartDateTime;
            const woEndTime = wo.EndTime || wo.ScheduledEndTime || wo.End || wo.EndDateTime;
            const woStaffId = wo.Staff?.ID || wo.StaffID || wo.StaffId || wo.Technician?.ID || wo.TechnicianID;
            const woDuration = wo.Duration || wo.Hours || wo.TotalHours || wo.HoursWorked;
            
            if (woStartTime && woEndTime && woStaffId) {
              try {
                const start = new Date(woStartTime);
                const end = new Date(woEndTime);
                if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                  const hours = ((end - start) / (1000 * 60 * 60)).toFixed(2);
                  const formattedDate = start.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                  const formattedStartTime = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
                  const formattedEndTime = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
                  
                  labour.push({
                    date: formattedDate,
                    engineer: `Dacha SSI Engineer (${woStaffId})`,
                    startTime: formattedStartTime,
                    endTime: formattedEndTime,
                    hours: hours
                  });
                  logger.debug(`[DEBUG] Added labour entry from work order ${woIdx}`);
                }
              } catch (error) {
                logger.warn(`Error parsing work order times: ${error.message}`);
              }
            } else if (woDuration && woStaffId) {
              const woDate = wo.Date || wo.WorkDate || wo.ScheduledDate || scheduleDate || new Date();
              try {
                const date = new Date(woDate);
                if (!isNaN(date.getTime())) {
                  const formattedDate = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                  
                  labour.push({
                    date: formattedDate,
                    engineer: `Dacha SSI Engineer (${woStaffId})`,
                    startTime: woStartTime ? new Date(woStartTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '',
                    endTime: woEndTime ? new Date(woEndTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '',
                    hours: parseFloat(woDuration).toFixed(2)
                  });
                  logger.debug(`[DEBUG] Added labour entry from work order ${woIdx} with duration`);
                }
              } catch (error) {
                logger.warn(`Error parsing work order date: ${error.message}`);
              }
            }
          });
        }
      });
    });
  });
  
  logger.info(`[DEBUG] extractValidLabour: Extracted ${labour.length} labour entries`);
  return labour;
}

function extractMaterials(sections) {
  const materials = [];
  logger.info(`[DEBUG] ===== extractMaterials: Processing ${sections?.length || 0} sections =====`);
  
  if (!sections || sections.length === 0) {
    logger.warn(`[DEBUG] extractMaterials: No sections provided!`);
    return materials;
  }
  
  sections?.forEach((section, sectionIdx) => {
    logger.info(`[DEBUG] extractMaterials: Section ${sectionIdx}, has costCenters: ${!!section.costCenters}, count: ${section.costCenters?.length || 0}`);
    
    // Check for materials in costCenters
    section.costCenters?.forEach((cc, ccIdx) => {
      // Try multiple possible field names for materials/catalogue parts
      const materialsList = cc.materials || cc.Materials || cc.items || cc.Items || cc.CatalogueParts || cc.catalogueParts || [];
      logger.info(`[DEBUG] extractMaterials: CostCenter ${ccIdx}, materialsList length: ${materialsList.length}`);
      
      if (materialsList.length > 0) {
        logger.info(`[DEBUG] extractMaterials: First material in list:`, JSON.stringify(materialsList[0], null, 2).substring(0, 500));
      }
      
      materialsList.forEach((material, matIdx) => {
        // Try multiple field names for quantity
        const quantity = material.Quantity || material.quantity || material.Qty || material.qty || material.QuantityUsed || material.quantityUsed || 0;
        // Try multiple field names for name/description
        const name = material.Name || material.Description || material.name || material.description || material.CatalogueItem?.Name || material.CatalogueItem?.Description || 'Unknown';
        // Try multiple field names for unit
        const unit = material.Unit || material.unit || material.UnitOfMeasure || material.unitOfMeasure || 'ea';
        // Try multiple field names for price
        const unitPrice = material.UnitPrice || material.unitPrice || material.Price || material.price || material.CatalogueItem?.UnitPrice || 0;
        
        logger.debug(`[DEBUG] extractMaterials: Material ${matIdx} - quantity: ${quantity}, name: ${name}`);
        
        // Accept materials with quantity > 0 OR if they have a name (some materials might have 0 quantity but still be used)
        if ((quantity && quantity > 0) || (name && name !== 'Unknown')) {
          materials.push({
            name: name,
            quantity: quantity.toString(),
            unit: unit,
            unitPrice: unitPrice,
            total: (parseFloat(quantity || 0) * parseFloat(unitPrice || 0)).toFixed(2)
          });
          logger.debug(`[DEBUG] extractMaterials: Added material: ${name}`);
        }
      });
    });
    
    // Also check if materials are directly in the section
    const sectionMaterials = section.materials || section.Materials || section.items || section.Items || section.CatalogueParts || section.catalogueParts || [];
    logger.debug(`[DEBUG] extractMaterials: Section ${sectionIdx} direct materials count: ${sectionMaterials.length}`);
    
    sectionMaterials.forEach((material, matIdx) => {
      const quantity = material.Quantity || material.quantity || material.Qty || material.qty || material.QuantityUsed || material.quantityUsed || 0;
      const name = material.Name || material.Description || material.name || material.description || material.CatalogueItem?.Name || material.CatalogueItem?.Description || 'Unknown';
      const unit = material.Unit || material.unit || material.UnitOfMeasure || material.unitOfMeasure || 'ea';
      const unitPrice = material.UnitPrice || material.unitPrice || material.Price || material.price || material.CatalogueItem?.UnitPrice || 0;
      
      if ((quantity && quantity > 0) || (name && name !== 'Unknown')) {
        materials.push({
          name: name,
          quantity: quantity.toString(),
          unit: unit,
          unitPrice: unitPrice,
          total: (parseFloat(quantity || 0) * parseFloat(unitPrice || 0)).toFixed(2)
        });
      }
    });
  });
  
  logger.info(`[DEBUG] extractMaterials: Total materials extracted: ${materials.length}`);
  return materials;
}

function extractSingleWorkSummary(sections) {
  const notes = [];
  
  // Check sections for notes (Notes, Description, WorkSummary fields)
  sections?.forEach(section => {
    // Check section-level notes
    if (section.Notes && section.Notes.trim()) {
      notes.push(section.Notes.trim());
    }
    if (section.Description && section.Description.trim()) {
      notes.push(section.Description.trim());
    }
    if (section.WorkSummary && section.WorkSummary.trim()) {
      notes.push(section.WorkSummary.trim());
    }
    
    // Check cost centers
    section.costCenters?.forEach(cc => {
      // Check cost center notes
      if (cc.Notes && cc.Notes.trim()) {
        notes.push(cc.Notes.trim());
      }
      if (cc.Description && cc.Description.trim()) {
        notes.push(cc.Description.trim());
      }
      
      // Check schedules
      cc.schedules?.forEach(schedule => {
        if (schedule.Notes && schedule.Notes.trim()) {
          notes.push(schedule.Notes.trim());
        }
        if (schedule.Description && schedule.Description.trim()) {
          notes.push(schedule.Description.trim());
        }
        // Check for work order notes in schedule (enhanced work notes from timesheets)
        if (schedule.workOrders && Array.isArray(schedule.workOrders)) {
          schedule.workOrders.forEach(wo => {
            if (wo.Notes && wo.Notes.trim()) {
              notes.push(wo.Notes.trim());
            }
            if (wo.Description && wo.Description.trim()) {
              notes.push(wo.Description.trim());
            }
            if (wo.WorkNotes && wo.WorkNotes.trim()) {
              notes.push(wo.WorkNotes.trim());
            }
            if (wo.Note && wo.Note.trim()) {
              notes.push(wo.Note.trim());
            }
            // Check for timesheet notes
            if (wo.TimesheetNotes && wo.TimesheetNotes.trim()) {
              notes.push(wo.TimesheetNotes.trim());
            }
          });
        }
        if (schedule.WorkOrder && schedule.WorkOrder.Notes && schedule.WorkOrder.Notes.trim()) {
          notes.push(schedule.WorkOrder.Notes.trim());
        }
        if (schedule.WorkOrder && schedule.WorkOrder.Description && schedule.WorkOrder.Description.trim()) {
          notes.push(schedule.WorkOrder.Description.trim());
        }
      });
    });
  });
  
  const notesText = notes.join(' ').trim();
  if (notesText.length === 0) {
    return null; // Return null if no notes to prevent duplication
  }
  
  logger.debug(`[DEBUG] extractSingleWorkSummary: Found notes text (first 500 chars): ${notesText.substring(0, 500)}`);
  
  // Simple parsing for Diagnostics, Actions Taken, Results
  const diagnosticsMatch = notesText.match(/Diagnostics[:\s]*(.*?)(?:\*\*|Actions Taken|Results|$)/is);
  const actionsMatch = notesText.match(/Actions Taken[:\s]*(.*?)(?:\*\*|Results|$)/is);
  const resultsMatch = notesText.match(/Results[:\s]*(.*?)$/is);
  
  return {
    diagnostics: diagnosticsMatch ? diagnosticsMatch[1].trim() : '',
    actionsTaken: actionsMatch ? actionsMatch[1].trim() : '',
    results: resultsMatch ? resultsMatch[1].trim() : ''
  };
}

async function fetchSchedulesFromCostCenter({ jobId, sectionId, costCenterId }) {
  try {
    // List schedules (requires trailing slash in this build)
    const listUrl = `/companies/${companyId}/jobs/${jobId}/sections/${sectionId}/costCenters/${costCenterId}/schedules/`;
    const list = await fetchWithRetry(listUrl);
    const listArr = Array.isArray(list) ? list : (list ? [list] : []);

    const rows = [];
    for (const s of listArr) {
      const scheduleId = s?.ID || s?.Id || s?.id;
      if (!scheduleId) continue;
      try {
        await delay(150);
        const detailUrl = `/companies/${companyId}/jobs/${jobId}/sections/${sectionId}/costCenters/${costCenterId}/schedules/${scheduleId}`;
        const detail = await fetchWithRetry(detailUrl);
        rows.push(detail);
      } catch (e) {
        logger.debug(`[DEBUG] Could not fetch schedule detail ${scheduleId}: ${e.message}`);
      }
    }
    return rows;
  } catch (e) {
    logger.warn(`[DEBUG] Could not fetch schedules for cost center ${costCenterId}: ${e.message}`);
    return [];
  }
}

function normalizeScheduleEntries(scheduleDetails) {
  const entries = [];
  const details = Array.isArray(scheduleDetails) ? scheduleDetails : [];

  const toNum = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const pickTimeAsc = (a, b) => {
    const sa = String(a || '');
    const sb = String(b || '');
    if (!sa) return sb;
    if (!sb) return sa;
    return sa.localeCompare(sb) <= 0 ? sa : sb;
  };

  const pickTimeDesc = (a, b) => {
    const sa = String(a || '');
    const sb = String(b || '');
    if (!sa) return sb;
    if (!sb) return sa;
    return sa.localeCompare(sb) >= 0 ? sa : sb;
  };

  for (const sched of details) {
    const date = sched?.Date || '';
    const staffId = sched?.Staff?.ID || sched?.StaffID || sched?.StaffId || sched?.Technician?.ID || '';
    const staffName = sched?.Staff?.Name || sched?.StaffName || sched?.Technician?.Name || '';

    const schedNormal = sched?.NormalTime ?? sched?.NormalHrs ?? sched?.NormalHours ?? null;
    const schedTravel = sched?.Travel ?? sched?.TravelTime ?? sched?.TravelHrs ?? sched?.TravelHours ?? null;

    const blocks = Array.isArray(sched?.Blocks) ? sched.Blocks : [];

    // If Simpro provides schedule-level Normal + Travel, prefer that summary to avoid accidentally
    // counting travel blocks that are not explicitly typed.
    if (blocks.length > 0 && schedNormal !== null && schedNormal !== undefined) {
      const normalN = toNum(schedNormal);
      const travelN = toNum(schedTravel);

      // If there's any travel time recorded, collapse to one row using NormalTime only.
      if (travelN > 0) {
        if (normalN <= 0) continue; // travel-only schedule, exclude it entirely

        let start = '';
        let end = '';
        for (const b of blocks) {
          start = pickTimeAsc(start, b?.StartTime || '');
          end = pickTimeDesc(end, b?.EndTime || '');
        }

        entries.push({
          date,
          engineerId: staffId ? String(staffId) : '',
          engineerName: staffName ? String(staffName) : '',
          startTime: start ? String(start) : '',
          endTime: end ? String(end) : '',
          hours: String(schedNormal)
        });
        continue;
      }
    }

    if (blocks.length > 0) {
      for (const b of blocks) {
        const scheduleRateName = String(b?.ScheduleRate?.Name || '').toLowerCase();
        const blockType = String(
          b?.Type ??
          b?.BlockType ??
          b?.ActivityType ??
          b?.Category ??
          b?.Name ??
          ''
        ).toLowerCase();
        const typeHint = `${blockType} ${scheduleRateName}`.trim();

        const start = b?.StartTime || '';
        const end = b?.EndTime || '';

        // Prefer "NormalTime" (labour) over totals that may include travel.
        const normal = b?.NormalTime ?? b?.NormalHrs ?? b?.NormalHours ?? null;
        const travel = b?.Travel ?? b?.TravelTime ?? b?.TravelHrs ?? b?.TravelHours ?? null;

        // Skip travel-only blocks (or explicitly travel typed blocks).
        if (typeHint.includes('travel')) continue;
        if (travel !== null && travel !== undefined && toNum(travel) > 0 && toNum(normal) === 0) continue;

        const hours =
          (normal !== null && normal !== undefined)
            ? normal
            : (b?.Hrs ?? b?.Hours ?? b?.LabourTime ?? b?.LaborTime ?? sched?.NormalTime ?? sched?.TotalHours ?? '');

        // Skip zero-hour rows (typically travel-only or empty)
        if (toNum(hours) <= 0) continue;

        entries.push({
          date,
          engineerId: staffId ? String(staffId) : '',
          engineerName: staffName ? String(staffName) : '',
          startTime: start ? String(start) : '',
          endTime: end ? String(end) : '',
          hours: hours !== null && hours !== undefined ? String(hours) : ''
        });
      }
    } else {
      // Fallback to schedule-level totals if no blocks (exclude travel where possible)
      const normal = sched?.NormalTime ?? sched?.NormalHrs ?? sched?.NormalHours ?? null;
      const travel = sched?.Travel ?? sched?.TravelTime ?? sched?.TravelHrs ?? sched?.TravelHours ?? null;
      const total = sched?.TotalHours ?? sched?.Total ?? null;
      const derived =
        (total !== null && total !== undefined && travel !== null && travel !== undefined)
          ? (toNum(total) - toNum(travel))
          : null;

      const hours =
        (normal !== null && normal !== undefined)
          ? normal
          : (derived !== null ? derived : (total ?? ''));

      if (toNum(hours) <= 0) continue;
      entries.push({
        date,
        engineerId: staffId ? String(staffId) : '',
        engineerName: staffName ? String(staffName) : '',
        startTime: '',
        endTime: '',
        hours: hours !== null && hours !== undefined ? String(hours) : ''
      });
    }
  }

  // Sort by date asc then startTime
  entries.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.startTime || '').localeCompare(b.startTime || ''));
  return entries;
}

export async function getJobCardData(jobId) {
  try {
    logger.info(`Fetching job card data for job ${jobId}`);
    logger.info(`Using base URL: ${baseUrl}, Company ID: ${companyId}`);
    
    // Fetch job details
    const jobUrl = `/companies/${companyId}/jobs/${jobId}`;
    const fullUrl = `${baseUrl}${jobUrl}`;
    logger.info(`Fetching job from: ${fullUrl}`);
    
    const job = await fetchWithRetry(jobUrl);
    
    if (!job || !job.ID) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Fetch sections (note: Simpro can require trailing slash on list routes)
    let sectionsList = [];
    try {
      await delay(200);
      const sectionsUrl = `/companies/${companyId}/jobs/${jobId}/sections/`;
      const secs = await fetchWithRetry(sectionsUrl);
      sectionsList = Array.isArray(secs) ? secs : (secs ? [secs] : []);
    } catch (e) {
      logger.warn(`[DEBUG] Could not fetch sections list for job ${jobId}: ${e.message}`);
      sectionsList = [];
    }

    // Fetch schedules from cost center (for Scheduled Time table)
    let scheduleEntries = [];
    try {
      // Use first section and first cost center (matches our working materials approach for 53582)
      const firstSectionId = sectionsList?.[0]?.ID || sectionsList?.[0]?.Id || sectionsList?.[0]?.id;
      if (firstSectionId) {
        await delay(150);
        const ccUrl = `/companies/${companyId}/jobs/${jobId}/sections/${firstSectionId}/costCenters/`;
        const ccs = await fetchWithRetry(ccUrl);
        const ccArr = Array.isArray(ccs) ? ccs : (ccs ? [ccs] : []);
        const firstCostCenterId = ccArr?.[0]?.ID || ccArr?.[0]?.Id || ccArr?.[0]?.id;
        if (firstCostCenterId) {
          const scheduleDetails = await fetchSchedulesFromCostCenter({
            jobId,
            sectionId: Number(firstSectionId),
            costCenterId: Number(firstCostCenterId)
          });
          scheduleEntries = normalizeScheduleEntries(scheduleDetails);
        }
      }
    } catch (e) {
      logger.warn(`[DEBUG] Could not build schedule entries for job ${jobId}: ${e.message}`);
      scheduleEntries = [];
    }

    // Fetch materials from job cost center catalog items (via /catalogs/ endpoint)
    // Verified working path for job 53582:
    // /companies/{companyId}/jobs/{jobId}/sections/{sectionId}/costCenters/{costCenterId}/catalogs/
    let ccCatalogMaterials = [];
    try {
      const sectionIds = sectionsList
        .map(s => s?.ID || s?.Id || s?.id)
        .filter(Boolean)
        .map(v => Number(v))
        .filter(v => !Number.isNaN(v));

      for (const sectionId of sectionIds) {
        await delay(150);
        const ccUrl = `/companies/${companyId}/jobs/${jobId}/sections/${sectionId}/costCenters/`;
        const ccs = await fetchWithRetry(ccUrl);
        const ccArr = Array.isArray(ccs) ? ccs : (ccs ? [ccs] : []);

        for (const cc of ccArr) {
          const costCenterId = cc?.ID || cc?.Id || cc?.id;
          if (!costCenterId) continue;

          try {
            await delay(150);
            const catalogsUrl = `/companies/${companyId}/jobs/${jobId}/sections/${sectionId}/costCenters/${costCenterId}/catalogs/`;
            const catalogs = await fetchWithRetry(catalogsUrl);
            const catArr = Array.isArray(catalogs) ? catalogs : (catalogs ? [catalogs] : []);

            for (const item of catArr) {
              const name = item?.Catalog?.Name || item?.Catalogue?.Name || item?.Name || item?.Description || '';
              const qty = item?.Total?.Qty ?? item?.Qty ?? item?.Quantity ?? item?.quantity ?? null;
              if (!name) continue;
              ccCatalogMaterials.push({
                name,
                quantity: qty !== null && qty !== undefined ? String(qty) : '',
                raw: item
              });
            }
          } catch (e2) {
            // Catalogs endpoint may 404 for some cost centers; keep going
            logger.debug(`[DEBUG] No catalogs for cost center ${costCenterId} (section ${sectionId}): ${e2.message}`);
          }
        }
      }
    } catch (e) {
      logger.warn(`[DEBUG] Could not fetch cost center catalogs for job ${jobId}: ${e.message}`);
      ccCatalogMaterials = [];
    }

    // Fetch site details (for Address on job card)
    let siteDetails = null;
    try {
      const siteId = job?.Site?.ID || job?.SiteID || job?.SiteId || job?.Site?.Id || job?.siteId;
      if (siteId !== null && siteId !== undefined && siteId !== '') {
        await delay(200);
        const siteUrl = `/companies/${companyId}/sites/${siteId}`;
        siteDetails = await fetchWithRetry(siteUrl);
      }
    } catch (e) {
      logger.warn(`[DEBUG] Could not fetch site details: ${e.message}`);
      siteDetails = null;
    }
    
    // Log job structure to see if it has sections/cost centers embedded
    logger.info(`[DEBUG] ===== JOB OBJECT KEYS: ${Object.keys(job).join(', ')} =====`);
    
    // Check for cost center related fields in job object
    const costCenterFields = [];
    Object.keys(job).forEach(key => {
      if (key.toLowerCase().includes('cost') || key.toLowerCase().includes('center') || key.toLowerCase().includes('centre')) {
        costCenterFields.push(key);
      }
    });
    if (costCenterFields.length > 0) {
      logger.info(`[DEBUG] ===== COST CENTER RELATED FIELDS IN JOB: ${costCenterFields.join(', ')} =====`);
      costCenterFields.forEach(field => {
        logger.info(`[DEBUG] Job.${field}:`, JSON.stringify(job[field], null, 2).substring(0, 500));
      });
    }
    
    // Check if job has sections, cost centers, or schedules embedded
    if (job.Sections) {
      logger.info(`[DEBUG] Job has Sections field:`, JSON.stringify(job.Sections, null, 2).substring(0, 1000));
    }
    if (job.sections) {
      logger.info(`[DEBUG] Job has sections field:`, JSON.stringify(job.sections, null, 2).substring(0, 1000));
    }
    if (job.CostCenters) {
      logger.info(`[DEBUG] Job has CostCenters field:`, JSON.stringify(job.CostCenters, null, 2).substring(0, 1000));
    }
    if (job.costCenters) {
      logger.info(`[DEBUG] Job has costCenters field:`, JSON.stringify(job.costCenters, null, 2).substring(0, 1000));
    }
    if (job.CostCenter) {
      logger.info(`[DEBUG] Job has CostCenter field:`, JSON.stringify(job.CostCenter, null, 2).substring(0, 1000));
    }
    if (job.costCenter) {
      logger.info(`[DEBUG] Job has costCenter field:`, JSON.stringify(job.costCenter, null, 2).substring(0, 1000));
    }
    if (job.Schedules) {
      logger.info(`[DEBUG] Job has Schedules field`);
    }
    if (job.schedules) {
      logger.info(`[DEBUG] Job has schedules field`);
    }
    
    // Also check Totals structure - it might have cost center info
    if (job.Totals) {
      logger.info(`[DEBUG] Job.Totals structure:`, JSON.stringify(job.Totals, null, 2).substring(0, 1000));
    }
    
    // Check CustomFields and STC - they might contain cost center info
    if (job.CustomFields && Array.isArray(job.CustomFields)) {
      logger.info(`[DEBUG] Job has ${job.CustomFields.length} CustomFields`);
      const costCenterCustomFields = job.CustomFields.filter(cf => 
        (cf.Name && (cf.Name.toLowerCase().includes('cost') || cf.Name.toLowerCase().includes('center') || cf.Name.toLowerCase().includes('centre'))) ||
        (cf.Field && (cf.Field.toLowerCase().includes('cost') || cf.Field.toLowerCase().includes('center') || cf.Field.toLowerCase().includes('centre')))
      );
      if (costCenterCustomFields.length > 0) {
        logger.info(`[DEBUG] Cost center related CustomFields:`, JSON.stringify(costCenterCustomFields, null, 2));
      }
    }
    if (job.STC) {
      logger.info(`[DEBUG] Job.STC:`, JSON.stringify(job.STC, null, 2).substring(0, 500));
    }
    
    // Extract any potential cost center IDs from job object
    // Try to find cost center ID in various possible locations
    const potentialCostCenterIds = [];
    if (job.CostCenterID) potentialCostCenterIds.push(job.CostCenterID);
    if (job.CostCenterId) potentialCostCenterIds.push(job.CostCenterId);
    if (job.CostCenter?.ID) potentialCostCenterIds.push(job.CostCenter.ID);
    if (job.costCenterID) potentialCostCenterIds.push(job.costCenterID);
    if (job.costCenterId) potentialCostCenterIds.push(job.costCenterId);
    if (job.costCenter?.id) potentialCostCenterIds.push(job.costCenter.id);
    
    // Also check if cost center ID is embedded in other fields (like Name, Description, etc.)
    // Format examples:
    // - "Dacha Internal Projects (#53582-124538)" where 124538 is the cost center ID
    // - "Service Job #53582 - Job Card Automation / Cost Centres / Dacha Internal Projects #124538" where 124538 is the cost center ID
    // - Look for patterns like "#124538" or "/ #124538" or "Cost Centres / ... #124538"
    if (job.Name) {
      // Try pattern: #jobId-costCenterId
      const nameMatch1 = job.Name.match(/#\d+-(\d+)/);
      if (nameMatch1) {
        potentialCostCenterIds.push(nameMatch1[1]);
        logger.info(`[DEBUG] Found cost center ID in job Name (pattern 1): ${nameMatch1[1]}`);
      }
      // Try pattern: / Cost Centres / ... #costCenterId
      const nameMatch2 = job.Name.match(/Cost Centres?[^#]*#(\d+)/i);
      if (nameMatch2) {
        potentialCostCenterIds.push(nameMatch2[1]);
        logger.info(`[DEBUG] Found cost center ID in job Name (pattern 2): ${nameMatch2[1]}`);
      }
      // Try pattern: standalone #costCenterId at the end
      const nameMatch3 = job.Name.match(/#(\d+)\s*$/);
      if (nameMatch3) {
        potentialCostCenterIds.push(nameMatch3[1]);
        logger.info(`[DEBUG] Found cost center ID in job Name (pattern 3): ${nameMatch3[1]}`);
      }
    }
    if (job.Description) {
      // Try same patterns in Description
      const descMatch1 = job.Description.match(/#\d+-(\d+)/);
      if (descMatch1) {
        potentialCostCenterIds.push(descMatch1[1]);
        logger.info(`[DEBUG] Found cost center ID in job Description (pattern 1): ${descMatch1[1]}`);
      }
      const descMatch2 = job.Description.match(/Cost Centres?[^#]*#(\d+)/i);
      if (descMatch2) {
        potentialCostCenterIds.push(descMatch2[1]);
        logger.info(`[DEBUG] Found cost center ID in job Description (pattern 2): ${descMatch2[1]}`);
      }
      const descMatch3 = job.Description.match(/#(\d+)\s*$/);
      if (descMatch3) {
        potentialCostCenterIds.push(descMatch3[1]);
        logger.info(`[DEBUG] Found cost center ID in job Description (pattern 3): ${descMatch3[1]}`);
      }
    }
    
    // Extract cost center ID from job name/description
    // Pattern: "Service Job #53582 - Job Card Automation / Cost Centres / Dacha Internal Projects #124538"
    // Where 124538 is the cost center ID
    let extractedCostCenterId = null;
    if (job.Name) {
      // Look for pattern: "Cost Centres / ... #124538" or "/ #124538"
      const ccMatch = job.Name.match(/(?:Cost Centres?[^#]*|\/)\s*#(\d+)/i);
      if (ccMatch) {
        extractedCostCenterId = ccMatch[1];
        potentialCostCenterIds.push(extractedCostCenterId);
        logger.info(`[DEBUG] ===== EXTRACTED COST CENTER ID FROM JOB NAME: ${extractedCostCenterId} =====`);
      }
    }
    if (!extractedCostCenterId && job.Description) {
      const ccMatch2 = job.Description.match(/(?:Cost Centres?[^#]*|\/)\s*#(\d+)/i);
      if (ccMatch2) {
        extractedCostCenterId = ccMatch2[1];
        potentialCostCenterIds.push(extractedCostCenterId);
        logger.info(`[DEBUG] ===== EXTRACTED COST CENTER ID FROM JOB DESCRIPTION: ${extractedCostCenterId} =====`);
      }
    }
    
    if (potentialCostCenterIds.length > 0) {
      logger.info(`[DEBUG] ===== FOUND POTENTIAL COST CENTER IDs IN JOB: ${potentialCostCenterIds.join(', ')} =====`);
      // Use the first one (most likely the extracted one)
      extractedCostCenterId = potentialCostCenterIds[0];
    } else {
      logger.info(`[DEBUG] ===== NO COST CENTER IDs FOUND IN JOB OBJECT =====`);
    }
    
    // Fetch customer details
    let customerDetails = null;
    if (job.Customer?.ID) {
      try {
        await delay(500); // Rate limiting
        // Simpro API requires: /companies/{companyId}/customers/companies/{customerId}
        customerDetails = await fetchWithRetry(`/companies/${companyId}/customers/companies/${job.Customer.ID}`);
      } catch (error) {
        logger.warn(`Could not fetch customer details: ${error.message}`);
      }
    }
    
    // Fetch job sections (labour, materials, etc.)
    // Check job type first - Service jobs may not have sections
    const jobType = job.Type || job.JobType || '';
    logger.info(`[DEBUG] ===== JOB TYPE: ${jobType} =====`);
    
    // Following the working project's approach for Project jobs:
    // 1. GET /jobs/{jobId}/sections/ - take first section
    // 2. GET /jobs/{jobId}/sections/{sectionId}/costCenters/ - take first cost center
    // 3. GET /jobs/{jobId}/sections/{sectionId}/costCenters/{costCenterId}/schedules/ - get schedules
    // For Service jobs, try direct cost centers endpoint
    let sections = [];
    await delay(500);
    
    try {
      // Step 1: Try to fetch sections (works for Project jobs, may fail for Service jobs)
      const sectionsUrl = `/companies/${companyId}/jobs/${jobId}/sections`;
      logger.info(`[DEBUG] ===== FETCHING SECTIONS FROM: ${sectionsUrl} =====`);
      const fetchedSections = await fetchWithRetry(sectionsUrl);
      const sectionsArray = Array.isArray(fetchedSections) ? fetchedSections : (fetchedSections ? [fetchedSections] : []);
      logger.info(`[DEBUG] ===== FOUND ${sectionsArray.length} SECTIONS =====`);
      
      if (sectionsArray.length === 0) {
        throw new Error('No sections found');
      }
      
      // Step 2: Take the first section (matching working project behavior)
      const firstSection = sectionsArray[0];
      const sectionId = firstSection.ID || firstSection.Id || firstSection.id;
      
      if (!sectionId) {
        throw new Error('First section has no ID');
      }
      
      logger.info(`[DEBUG] ===== USING FIRST SECTION: ${sectionId} =====`);
      
      // Step 3: Fetch cost centers for the first section
      await delay(200); // Rate limiting
      const costCentersUrl = `/companies/${companyId}/jobs/${jobId}/sections/${sectionId}/costcenters`;
      logger.info(`[DEBUG] ===== FETCHING COST CENTERS FROM: ${costCentersUrl} =====`);
      const costCenters = await fetchWithRetry(costCentersUrl);
      const ccArray = Array.isArray(costCenters) ? costCenters : (costCenters ? [costCenters] : []);
      logger.info(`[DEBUG] ===== FOUND ${ccArray.length} COST CENTERS FOR SECTION ${sectionId} =====`);
      
      if (ccArray.length === 0) {
        throw new Error('No cost centers found for section');
      }
      
      // Step 4: Take the first cost center (matching working project behavior)
      const firstCostCenter = ccArray[0];
      const costCenterId = firstCostCenter.ID || firstCostCenter.Id || firstCostCenter.id;
      
      if (!costCenterId) {
        throw new Error('First cost center has no ID');
      }
      
      logger.info(`[DEBUG] ===== USING FIRST COST CENTER: ${costCenterId} =====`);
      
      // Step 5: Fetch schedules for the first cost center
      await delay(200); // Rate limiting
      const schedulesUrl = `/companies/${companyId}/jobs/${jobId}/sections/${sectionId}/costcenters/${costCenterId}/schedules`;
      logger.info(`[DEBUG] ===== FETCHING SCHEDULES FROM: ${schedulesUrl} =====`);
      const schedules = await fetchWithRetry(schedulesUrl);
      const schedulesArray = Array.isArray(schedules) ? schedules : (schedules ? [schedules] : []);
      logger.info(`[DEBUG] ===== FOUND ${schedulesArray.length} SCHEDULES FOR COST CENTER ${costCenterId} =====`);
      
      if (schedulesArray.length > 0) {
        logger.info(`[DEBUG] First schedule:`, JSON.stringify(schedulesArray[0], null, 2).substring(0, 1000));
      }
      
      // For each schedule, fetch work orders to get enhanced work notes
      const enrichedSchedules = await Promise.all(schedulesArray.map(async (schedule) => {
        const scheduleId = schedule.ID || schedule.Id || schedule.id;
        if (!scheduleId) return schedule;
        
        // Fetch work orders for this schedule
        try {
          await delay(200); // Rate limiting
          const workOrdersUrl = `/companies/${companyId}/jobs/${jobId}/sections/${sectionId}/costcenters/${costCenterId}/schedules/${scheduleId}/workorders`;
          logger.info(`[DEBUG] Fetching work orders from: ${workOrdersUrl}`);
          const workOrders = await fetchWithRetry(workOrdersUrl);
          const workOrdersArray = Array.isArray(workOrders) ? workOrders : (workOrders ? [workOrders] : []);
          logger.info(`[DEBUG] Found ${workOrdersArray.length} work orders for schedule ${scheduleId}`);
          
          // Attach work orders to schedule
          schedule.workOrders = workOrdersArray;
        } catch (error) {
          logger.debug(`Could not fetch work orders for schedule ${scheduleId}: ${error.message}`);
        }
        
        return schedule;
      }));
      
      // Build sections structure with first section, first cost center, and schedules
      firstCostCenter.schedules = enrichedSchedules;
      firstSection.costCenters = [firstCostCenter];
      sections = [firstSection];
      
      logger.info(`[DEBUG] ===== SUCCESS! BUILT SECTIONS STRUCTURE WITH ${schedulesArray.length} SCHEDULES =====`);
      
      // Also fetch catalogue items and one-off items for the cost center
      // Try /catalogs/ endpoint first (as suggested by user)
      try {
        await delay(200);
        const catalogsUrl = `/companies/${companyId}/jobs/${jobId}/sections/${sectionId}/costcenters/${costCenterId}/catalogs`;
        logger.info(`[DEBUG] ===== FETCHING CATALOGS FROM: ${catalogsUrl} =====`);
        const catalogs = await fetchWithRetry(catalogsUrl);
        const catalogsArray = Array.isArray(catalogs) ? catalogs : (catalogs ? [catalogs] : []);
        logger.info(`[DEBUG] ===== FOUND ${catalogsArray.length} CATALOGS FOR COST CENTER ${costCenterId} =====`);
        
        if (catalogsArray.length > 0) {
          logger.info(`[DEBUG] First catalog item:`, JSON.stringify(catalogsArray[0], null, 2).substring(0, 500));
        }
        
        if (!firstCostCenter.materials) firstCostCenter.materials = [];
        firstCostCenter.materials.push(...catalogsArray);
        logger.info(`[DEBUG] ===== ADDED ${catalogsArray.length} CATALOGS TO COST CENTER MATERIALS (total: ${firstCostCenter.materials.length}) =====`);
      } catch (error) {
        logger.warn(`[DEBUG] Could not fetch catalogs for cost center ${costCenterId}: ${error.message}`);
        if (error.response?.status === 404) {
          logger.warn(`[DEBUG] Catalogs endpoint returned 404, trying alternative endpoints...`);
          
          // Fallback: Try catalogueitems endpoint
          try {
            await delay(200);
            const catalogueItemsUrl = `/companies/${companyId}/jobs/${jobId}/sections/${sectionId}/costcenters/${costCenterId}/catalogueitems`;
            logger.info(`[DEBUG] ===== FETCHING CATALOGUE ITEMS FROM: ${catalogueItemsUrl} =====`);
            const catalogueItems = await fetchWithRetry(catalogueItemsUrl);
            const itemsArray = Array.isArray(catalogueItems) ? catalogueItems : (catalogueItems ? [catalogueItems] : []);
            logger.info(`[DEBUG] ===== FOUND ${itemsArray.length} CATALOGUE ITEMS FOR COST CENTER ${costCenterId} =====`);
            
            if (itemsArray.length > 0) {
              logger.info(`[DEBUG] First catalogue item:`, JSON.stringify(itemsArray[0], null, 2).substring(0, 500));
            }
            
            if (!firstCostCenter.materials) firstCostCenter.materials = [];
            firstCostCenter.materials.push(...itemsArray);
            logger.info(`[DEBUG] ===== ADDED ${itemsArray.length} CATALOGUE ITEMS TO COST CENTER MATERIALS (total: ${firstCostCenter.materials.length}) =====`);
          } catch (error2) {
            logger.warn(`[DEBUG] Catalogue items endpoint also failed: ${error2.message}`);
          }
        }
      }
      
      // Also try one-off items
      try {
        await delay(200);
        const oneOffItemsUrl = `/companies/${companyId}/jobs/${jobId}/sections/${sectionId}/costcenters/${costCenterId}/oneoffitems`;
        logger.info(`[DEBUG] ===== FETCHING ONE-OFF ITEMS FROM: ${oneOffItemsUrl} =====`);
        const oneOffItems = await fetchWithRetry(oneOffItemsUrl);
        const oneOffArray = Array.isArray(oneOffItems) ? oneOffItems : (oneOffItems ? [oneOffItems] : []);
        logger.info(`[DEBUG] ===== FOUND ${oneOffArray.length} ONE-OFF ITEMS FOR COST CENTER ${costCenterId} =====`);
        
        if (oneOffArray.length > 0) {
          logger.info(`[DEBUG] First one-off item:`, JSON.stringify(oneOffArray[0], null, 2).substring(0, 500));
        }
        
        if (!firstCostCenter.materials) firstCostCenter.materials = [];
        firstCostCenter.materials.push(...oneOffArray);
        logger.info(`[DEBUG] ===== ADDED ${oneOffArray.length} ONE-OFF ITEMS TO COST CENTER MATERIALS (total: ${firstCostCenter.materials.length}) =====`);
      } catch (error) {
        logger.warn(`[DEBUG] Could not fetch one-off items for cost center ${costCenterId}: ${error.message}`);
        if (error.response?.status === 404) {
          logger.warn(`[DEBUG] One-off items endpoint returned 404 - endpoint may not exist for this job`);
        }
      }
      
      // Log final materials count before building sections structure
      logger.info(`[DEBUG] ===== FINAL MATERIALS COUNT IN COST CENTER: ${firstCostCenter.materials?.length || 0} =====`);
      
    } catch (error) {
      logger.error(`Failed to fetch sections/cost centers/schedules using working project approach: ${error.message}`);
      logger.error(`Error details:`, error);
      
      // Fallback: Use extracted cost center ID to fetch materials
      // Per forum post: materials and schedules are against the cost centre in the job
      // We extracted cost center ID from job name: "Cost Centres / ... #124538"
      if (extractedCostCenterId) {
        logger.info(`[DEBUG] ===== USING EXTRACTED COST CENTER ID: ${extractedCostCenterId} =====`);
        
        // First, try to get sections filtered by cost center ID (per forum post)
        // Forum shows: /jobs/?Sections.CostCenters.ID=in(6347,10277)
        // But we need to get sections for this specific job, so try:
        // /jobs/{jobId}/sections?CostCenters.ID={costCenterId}
        try {
          await delay(200);
          const sectionsWithCCUrl = `/companies/${companyId}/jobs/${jobId}/sections?CostCenters.ID=${extractedCostCenterId}`;
          logger.info(`[DEBUG] ===== TRYING SECTIONS WITH COST CENTER FILTER: ${sectionsWithCCUrl} =====`);
          const filteredSections = await fetchWithRetry(sectionsWithCCUrl);
          const filteredSectionsArray = Array.isArray(filteredSections) ? filteredSections : (filteredSections ? [filteredSections] : []);
          
          if (filteredSectionsArray.length > 0) {
            logger.info(`[DEBUG] ===== FOUND ${filteredSectionsArray.length} SECTIONS WITH COST CENTER ${extractedCostCenterId} =====`);
            // Use the first section
            const firstSection = filteredSectionsArray[0];
            const sectionId = firstSection.ID || firstSection.Id || firstSection.id;
            
            if (sectionId) {
              // Now fetch materials using the section and cost center
              const directMaterials = [];
              
              // Fetch catalogs
              try {
                await delay(200);
                const catalogsUrl = `/companies/${companyId}/jobs/${jobId}/sections/${sectionId}/costcenters/${extractedCostCenterId}/catalogs`;
                logger.info(`[DEBUG] ===== FETCHING CATALOGS FROM: ${catalogsUrl} =====`);
                const catalogs = await fetchWithRetry(catalogsUrl);
                const catalogsArray = Array.isArray(catalogs) ? catalogs : (catalogs ? [catalogs] : []);
                logger.info(`[DEBUG] ===== FOUND ${catalogsArray.length} CATALOGS FOR COST CENTER ${extractedCostCenterId} =====`);
                directMaterials.push(...catalogsArray);
              } catch (error2) {
                logger.warn(`[DEBUG] Catalogs endpoint failed: ${error2.message}`);
              }
              
              // Fetch one-off items
              try {
                await delay(200);
                const oneOffItemsUrl = `/companies/${companyId}/jobs/${jobId}/sections/${sectionId}/costcenters/${extractedCostCenterId}/oneoffitems`;
                logger.info(`[DEBUG] ===== FETCHING ONE-OFF ITEMS FROM: ${oneOffItemsUrl} =====`);
                const oneOffItems = await fetchWithRetry(oneOffItemsUrl);
                const oneOffArray = Array.isArray(oneOffItems) ? oneOffItems : (oneOffItems ? [oneOffItems] : []);
                logger.info(`[DEBUG] ===== FOUND ${oneOffArray.length} ONE-OFF ITEMS FOR COST CENTER ${extractedCostCenterId} =====`);
                directMaterials.push(...oneOffArray);
              } catch (error3) {
                logger.warn(`[DEBUG] One-off items endpoint failed: ${error3.message}`);
              }
              
              if (directMaterials.length > 0) {
                logger.info(`[DEBUG] ===== FOUND ${directMaterials.length} TOTAL MATERIALS FROM COST CENTER ${extractedCostCenterId} =====`);
                firstSection.costCenters = [{ ID: extractedCostCenterId, materials: directMaterials }];
                sections = [firstSection];
                // Successfully got materials, skip rest of fallback
              } else {
                // No materials found, continue to next approach
                sections = [firstSection];
              }
            }
          }
        } catch (error4) {
          logger.warn(`[DEBUG] Sections with cost center filter failed: ${error4.message}`);
        }
        
        // If filtered sections didn't work, try direct cost centers endpoint
        try {
          await delay(200);
          const costCentersUrl = `/companies/${companyId}/jobs/${jobId}/costcenters`;
          logger.info(`[DEBUG] ===== FETCHING COST CENTERS FROM: ${costCentersUrl} =====`);
          const costCenters = await fetchWithRetry(costCentersUrl);
          const ccArray = Array.isArray(costCenters) ? costCenters : (costCenters ? [costCenters] : []);
          logger.info(`[DEBUG] ===== FOUND ${ccArray.length} COST CENTERS DIRECTLY FROM JOB =====`);
          
          // Find the cost center matching our extracted ID
          const matchingCostCenter = ccArray.find(cc => {
            const ccId = cc.ID || cc.Id || cc.id;
            return ccId && (ccId.toString() === extractedCostCenterId.toString());
          });
          
          if (matchingCostCenter) {
            const costCenterId = matchingCostCenter.ID || matchingCostCenter.Id || matchingCostCenter.id;
            logger.info(`[DEBUG] ===== FOUND MATCHING COST CENTER: ${costCenterId} =====`);
            
            const directMaterials = [];
            
            // Try to get catalogs - need sectionId, so try to get sections first
            // Or try without sectionId
            try {
              await delay(200);
              // Try without section first
              const catalogsUrl = `/companies/${companyId}/jobs/${jobId}/costcenters/${costCenterId}/catalogs`;
              logger.info(`[DEBUG] ===== FETCHING CATALOGS FROM: ${catalogsUrl} =====`);
              const catalogs = await fetchWithRetry(catalogsUrl);
              const catalogsArray = Array.isArray(catalogs) ? catalogs : (catalogs ? [catalogs] : []);
              logger.info(`[DEBUG] ===== FOUND ${catalogsArray.length} CATALOGS FOR COST CENTER ${costCenterId} =====`);
              directMaterials.push(...catalogsArray);
            } catch (error5) {
              logger.warn(`[DEBUG] Direct cost center catalogs endpoint failed: ${error5.message}`);
            }
            
            // Try one-off items
            try {
              await delay(200);
              const oneOffItemsUrl = `/companies/${companyId}/jobs/${jobId}/costcenters/${costCenterId}/oneoffitems`;
              logger.info(`[DEBUG] ===== FETCHING ONE-OFF ITEMS FROM: ${oneOffItemsUrl} =====`);
              const oneOffItems = await fetchWithRetry(oneOffItemsUrl);
              const oneOffArray = Array.isArray(oneOffItems) ? oneOffItems : (oneOffItems ? [oneOffItems] : []);
              logger.info(`[DEBUG] ===== FOUND ${oneOffArray.length} ONE-OFF ITEMS FOR COST CENTER ${costCenterId} =====`);
              directMaterials.push(...oneOffArray);
            } catch (error6) {
              logger.warn(`[DEBUG] One-off items endpoint failed: ${error6.message}`);
            }
            
            if (directMaterials.length > 0) {
              logger.info(`[DEBUG] ===== FOUND ${directMaterials.length} TOTAL MATERIALS FROM COST CENTER ${costCenterId} =====`);
              matchingCostCenter.materials = directMaterials;
              sections = [{ costCenters: [matchingCostCenter] }];
            } else if (ccArray.length > 0) {
              sections = [{ costCenters: ccArray }];
            }
          } else if (ccArray.length > 0) {
            // Use first cost center if we can't find matching one
            const firstCostCenter = ccArray[0];
            const costCenterId = firstCostCenter.ID || firstCostCenter.Id || firstCostCenter.id;
            logger.info(`[DEBUG] ===== USING FIRST COST CENTER: ${costCenterId} =====`);
            
            const directMaterials = [];
            
            try {
              await delay(200);
              const catalogsUrl = `/companies/${companyId}/jobs/${jobId}/costcenters/${costCenterId}/catalogs`;
              logger.info(`[DEBUG] ===== FETCHING CATALOGS FROM: ${catalogsUrl} =====`);
              const catalogs = await fetchWithRetry(catalogsUrl);
              const catalogsArray = Array.isArray(catalogs) ? catalogs : (catalogs ? [catalogs] : []);
              logger.info(`[DEBUG] ===== FOUND ${catalogsArray.length} CATALOGS FOR COST CENTER ${costCenterId} =====`);
              directMaterials.push(...catalogsArray);
            } catch (error7) {
              logger.warn(`[DEBUG] Cost center catalogs endpoint failed: ${error7.message}`);
            }
            
            try {
              await delay(200);
              const oneOffItemsUrl = `/companies/${companyId}/jobs/${jobId}/costcenters/${costCenterId}/oneoffitems`;
              logger.info(`[DEBUG] ===== FETCHING ONE-OFF ITEMS FROM: ${oneOffItemsUrl} =====`);
              const oneOffItems = await fetchWithRetry(oneOffItemsUrl);
              const oneOffArray = Array.isArray(oneOffItems) ? oneOffItems : (oneOffItems ? [oneOffItems] : []);
              logger.info(`[DEBUG] ===== FOUND ${oneOffArray.length} ONE-OFF ITEMS FOR COST CENTER ${costCenterId} =====`);
              directMaterials.push(...oneOffArray);
            } catch (error8) {
              logger.warn(`[DEBUG] One-off items endpoint failed: ${error8.message}`);
            }
            
            if (directMaterials.length > 0) {
              logger.info(`[DEBUG] ===== FOUND ${directMaterials.length} TOTAL MATERIALS FROM COST CENTER ${costCenterId} =====`);
              firstCostCenter.materials = directMaterials;
              sections = [{ costCenters: [firstCostCenter] }];
            } else {
              sections = [{ costCenters: ccArray }];
            }
          } else {
          // No cost centers found, try direct materials endpoints as last resort
          logger.info(`[DEBUG] ===== NO COST CENTERS FOUND, TRYING DIRECT MATERIALS ENDPOINTS =====`);
          const directMaterials = [];
          
          try {
            await delay(200);
            const materialsUrl = `/companies/${companyId}/jobs/${jobId}/materials`;
            logger.info(`[DEBUG] ===== FETCHING MATERIALS FROM: ${materialsUrl} =====`);
            const materials = await fetchWithRetry(materialsUrl);
            const materialsArray = Array.isArray(materials) ? materials : (materials ? [materials] : []);
            logger.info(`[DEBUG] ===== FOUND ${materialsArray.length} MATERIALS FROM DIRECT ENDPOINT =====`);
            directMaterials.push(...materialsArray);
          } catch (error4) {
            logger.warn(`[DEBUG] Direct /materials endpoint failed: ${error4.message}`);
          }
          
          if (directMaterials.length > 0) {
            sections = [{ costCenters: [{ materials: directMaterials }] }];
          } else {
            sections = [];
          }
        }
      } catch (error5) {
        logger.warn(`[DEBUG] Direct cost centers endpoint also failed: ${error5.message}`);
        sections = [];
      }
      } // Close if (extractedCostCenterId) block
    }
    
    // If still no sections, log the full job object structure to help debug
    if (sections.length === 0) {
      logger.warn(`[DEBUG] No sections found. Job object keys:`, Object.keys(job));
      logger.warn(`[DEBUG] Job object sample (first 2000 chars):`, JSON.stringify(job, null, 2).substring(0, 2000));
    }
    
    // Extract engineers from sections/schedules/work orders
    const engineersList = extractEngineers(sections);
    
    // Also check job object for Technicians field (from Simpro API)
    if (job.Technicians && Array.isArray(job.Technicians) && job.Technicians.length > 0) {
      job.Technicians.forEach(tech => {
        const techId = tech.ID || tech.Id || tech.id;
        if (techId && !engineersList.find(e => e.id === techId)) {
          engineersList.push({
            name: tech.Name || `Engineer ${techId}`,
            id: techId
          });
        }
      });
    }
    
    // Also check single Technician field
    if (job.Technician && job.Technician.ID) {
      const techId = job.Technician.ID;
      if (!engineersList.find(e => e.id === techId)) {
        engineersList.push({
          name: job.Technician.Name || `Engineer ${techId}`,
          id: techId
        });
      }
    }
    
    logger.info(`[DEBUG] Extracted ${engineersList.length} engineers:`, engineersList);
    
    // Format engineers as "Dacha SSI Engineer (ID)"
    const engineerIds = engineersList.length > 0 
      ? engineersList.map(e => `Dacha SSI Engineer (${e.id})`)
      : [];
    
    // Get job creation date for Date Issued
    // According to Simpro API docs, DateCreated is RFC3339 date-time format (e.g., 2018-05-21T19:53:39+10:00)
    // This is the actual creation date. DateIssued is when the job was issued (may be different).
    // Priority: DateCreated (actual creation) > DateIssued (when issued) > other fields
    const dateIssuedRaw = job.DateCreated || job.DateIssued || job.CreatedDate || job.Created || 
                          job.CreatedOn || job.CreationDate || job.DateModified || job.Date;
    
    // Format the date properly (DateCreated is RFC3339 format, so new Date() will parse it correctly)
    let dateIssued = '';
    if (dateIssuedRaw) {
      try {
        const date = new Date(dateIssuedRaw);
        if (!isNaN(date.getTime())) {
          dateIssued = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } else {
          logger.warn(`Invalid date format: ${dateIssuedRaw}`);
        }
      } catch (error) {
        logger.warn(`Error parsing dateIssuedRaw ${dateIssuedRaw}: ${error.message}`);
      }
    }
    
    logger.info(`[DEBUG] DateCreated field: ${job.DateCreated}, DateIssued field: ${job.DateIssued}, formatted dateIssued: ${dateIssued}`);
    
    // Store the raw date for reference
    const createdDate = dateIssuedRaw;
    
    // Log sections structure for debugging
    logger.info(`[DEBUG] Sections structure for job ${jobId}:`, JSON.stringify({
      sectionsCount: sections.length,
      hasCostCenters: sections.some(s => s.costCenters),
      costCentersCount: sections.reduce((sum, s) => sum + (s.costCenters?.length || 0), 0),
      schedulesCount: sections.reduce((sum, s) => sum + (s.costCenters?.reduce((ccSum, cc) => ccSum + (cc.schedules?.length || 0), 0) || 0), 0),
      materialsCount: sections.reduce((sum, s) => sum + (s.costCenters?.reduce((ccSum, cc) => ccSum + (cc.materials?.length || 0), 0) || 0), 0),
      firstSection: sections[0] ? Object.keys(sections[0]) : [],
      firstCostCenter: sections[0]?.costCenters?.[0] ? Object.keys(sections[0].costCenters[0]) : [],
      fullSectionsStructure: sections.length > 0 ? JSON.stringify(sections[0], null, 2).substring(0, 1000) : 'No sections'
    }, null, 2));
    
    // Also check if job object itself has labour/materials
    logger.info(`[DEBUG] Job object structure:`, JSON.stringify({
      hasSections: !!job.Sections,
      hasCostCenters: !!job.CostCenters,
      hasSchedules: !!job.Schedules,
      hasMaterials: !!job.Materials,
      jobKeys: Object.keys(job).filter(k => /section|schedule|material|labour|cost/i.test(k))
    }, null, 2));
    
    // Raw description from Simpro (often HTML)
    const rawDescriptionHtml = job.Description || '';
    const { assets, prefix: descPrefix, cleaned: rawDescriptionText } = parseAssetsFromText(rawDescriptionHtml);

    // Fetch job notes (optional). Simpro routes are sensitive to trailing slashes:
    // - List:   GET /companies/{companyId}/jobs/{jobId}/notes/
    // - Detail: GET /companies/{companyId}/jobs/{jobId}/notes/{noteId}
    // This must never break job card generation.
    let jobNotes = '';
    try {
      await delay(200);
      const notesListUrl = `/companies/${companyId}/jobs/${jobId}/notes/`;
      const notesList = await fetchWithRetry(notesListUrl);
      const listArray = Array.isArray(notesList) ? notesList : (notesList ? [notesList] : []);

      const shouldExcludeNote = (subject) => /email notification/i.test(String(subject || ''));

      const filteredList = listArray.filter(n => !shouldExcludeNote(n?.Subject || n?.subject));

      const ids = filteredList
        .map(n => n?.ID || n?.Id || n?.id)
        .filter(Boolean)
        .map(v => Number(v))
        .filter(v => !Number.isNaN(v));

      // Prioritise the "Enhanced Engineer Work Note" note if present
      const preferred = filteredList
        .map(n => ({
          id: Number(n?.ID || n?.Id || n?.id),
          subject: String(n?.Subject || n?.subject || '')
        }))
        .filter(x => x.id && !Number.isNaN(x.id))
        .sort((a, b) => {
          const aPref = /enhanced engineer work note/i.test(a.subject) ? 1 : 0;
          const bPref = /enhanced engineer work note/i.test(b.subject) ? 1 : 0;
          return bPref - aPref;
        })
        .map(x => x.id);

      const noteIdsToFetch = (preferred.length > 0 ? preferred : ids).slice(0, 15);

      const chunks = [];
      for (const noteId of noteIdsToFetch) {
        try {
          await delay(150);
          const noteDetailUrl = `/companies/${companyId}/jobs/${jobId}/notes/${noteId}`;
          const detail = await fetchWithRetry(noteDetailUrl);

          const subject = detail?.Subject || detail?.subject || '';
          if (shouldExcludeNote(subject)) {
            continue;
          }
          const noteBody = detail?.Note || detail?.note || detail?.Notes || detail?.Text || '';
          const dateCreated = detail?.DateCreated || detail?.dateCreated || '';

          const header = [subject ? String(subject).trim() : null, dateCreated ? String(dateCreated).trim() : null]
            .filter(Boolean)
            .join(' - ');

          const body = String(noteBody || '').trim();
          if (body) {
            chunks.push(header ? `${header}\n${body}` : body);
          }
        } catch (e) {
          logger.debug(`[DEBUG] Could not fetch job note ${noteId}: ${e.message}`);
        }
      }

      jobNotes = chunks.join('\n\n').trim();
    } catch (error) {
      logger.warn(`[DEBUG] Could not fetch job notes: ${error.message}`);
    }

    // Determine Initial Request text:
    // Prefer the Job Description (what users expect as the initial request), and only fall back to notes if description is empty.
    const descriptionCandidate = (descPrefix || (assets.length === 0 ? rawDescriptionText : '') || '').trim();
    const initialRequestFallbacks = [
      job.RequestDescription,
      job.InitialRequest,
      job.Notes,
      jobNotes
    ]
      .map(v => (v ? String(v).trim() : ''))
      .filter(Boolean);

    const initialRequest = descriptionCandidate || initialRequestFallbacks[0] || '';
    const workCarriedOut = parseWorkCarriedOutFromText(jobNotes);
    
    // Build job card data
    const jobCardData = {
      job: {
        id: job.ID,
        jobNumber: job.JobNumber || job.ID.toString(),
        orderNo: job.OrderNo || null,
        name: job.Name || job.JobName || job.Title || '',
        // Keep the raw description (often HTML). Use job.initialRequest for the actual request text.
        description: rawDescriptionHtml,
        descriptionText: rawDescriptionText,
        initialRequest: initialRequest,
        assets: assets,
        workNotes: jobNotes,
        status: job.Status?.Name || '',
        priority: job.Priority?.Name || '',
        workOrderType: job.WorkOrderType?.Name || '',
        problemType: job.ProblemType?.Name || '',
        floorLevel: job.FloorLevel || '',
        locationDetails: job.LocationDetails || '',
        acceptSLA: job.AcceptSLA ? new Date(job.AcceptSLA).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
        createdDate: createdDate,
        dateIssued: dateIssued, // Use creation date for Date Issued
        responseSLA: job.ResponseSLA || '',
        fixSLA: job.FixSLA || '',
        nte: job.NTE || null,
        completedDate: job.CompletedDate
          ? new Date(job.CompletedDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : ''
      },
      site: (() => {
        const siteName = siteDetails?.Name || job?.Site?.Name || null;
        const a = siteDetails?.Address || null;
        return {
          id: siteDetails?.ID || job?.Site?.ID || null,
          name: siteName,
          address: a || null
        };
      })(),
      customer: (() => {
        let customerName = null;
        if (job.Customer?.CompanyName) {
          customerName = job.Customer.CompanyName;
        } else if (customerDetails?.CompanyName) {
          customerName = customerDetails.CompanyName;
        } else if (job.Customer?.GivenName || job.Customer?.FamilyName) {
          const parts = [job.Customer?.GivenName, job.Customer?.FamilyName].filter(Boolean);
          customerName = parts.length > 0 ? parts.join(' ') : null;
        }
        return {
          id: job.Customer?.ID,
          name: customerName,
          companyName: job.Customer?.CompanyName || customerDetails?.CompanyName || null,
          givenName: job.Customer?.GivenName,
          familyName: job.Customer?.FamilyName
        };
      })(),
      engineers: engineerIds.length > 0 ? engineerIds : ['Dacha SSI Engineer (N/A)'],
      labour: extractValidLabour(sections),
      materials: (() => {
        const fromSections = extractMaterials(sections);
        if (fromSections && fromSections.length > 0) return fromSections;
        // Fallback to the verified /catalogs/ endpoint under cost centers
        const simplified = (ccCatalogMaterials || []).map(m => ({
          name: m.name,
          quantity: m.quantity || '1',
          unit: '',
          unitPrice: 0,
          total: '0.00'
        }));
        // Deduplicate by name+quantity
        const seen = new Set();
        return simplified.filter(m => {
          const k = `${m.name}__${m.quantity}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      })(),
      workSummary: (() => {
        const fromSections = extractSingleWorkSummary(sections);
        if (fromSections && (fromSections.diagnostics || fromSections.actionsTaken || fromSections.results)) {
          return fromSections;
        }
        // Fallback: use job notes for service jobs / when sections/work orders are unavailable
        if (workCarriedOut && (workCarriedOut.diagnostics || workCarriedOut.actionsTaken || workCarriedOut.results || workCarriedOut.workNotes)) {
          return {
            diagnostics: workCarriedOut.diagnostics || '',
            actionsTaken: workCarriedOut.actionsTaken || '',
            results: workCarriedOut.results || '',
            workNotes: workCarriedOut.workNotes || ''
          };
        }
        return null;
      })(),
      scheduledTime: scheduleEntries,
      sections: sections
    };
    
    // Log extracted data for debugging
    logger.info(`[DEBUG] Extracted data for job ${jobId}:`, JSON.stringify({
      engineersCount: jobCardData.engineers.length,
      engineers: jobCardData.engineers,
      labourCount: jobCardData.labour.length,
      materialsCount: jobCardData.materials.length,
      dateIssued: jobCardData.job.acceptSLA,
      createdDate: jobCardData.job.createdDate
    }, null, 2));
    
    logger.info(`Successfully fetched job card data for job ${jobId}`);
    return jobCardData;
    
  } catch (error) {
    logger.error(`Error fetching job card data for job ${jobId}:`, error.message);
    if (error.response?.status === 404) {
      throw new Error(`Job ${jobId} not found`);
    }
    throw error;
  }
}
