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

function extractEngineers(sections) {
  const engineers = new Set();
  sections?.forEach(section => {
    section.costCenters?.forEach(cc => {
      cc.schedules?.forEach(schedule => {
        if (schedule.Staff?.Name && schedule.Staff.Name.trim()) {
          engineers.add({ name: schedule.Staff.Name.trim(), id: schedule.Staff.ID });
        }
      });
    });
  });
  return Array.from(engineers);
}

function extractValidLabour(sections) {
  const labour = [];
  sections?.forEach(section => {
    section.costCenters?.forEach(cc => {
      cc.schedules?.forEach(schedule => {
        if (schedule.StartTime && schedule.EndTime && schedule.Staff?.ID) {
          const start = new Date(schedule.StartTime);
          const end = new Date(schedule.EndTime);
          const hours = ((end - start) / (1000 * 60 * 60)).toFixed(2);
          const formattedDate = start.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
          const formattedStartTime = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
          const formattedEndTime = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
          
          labour.push({
            date: formattedDate,
            engineer: `Dacha SSI Engineer (${schedule.Staff?.ID || 'N/A'})`,
            startTime: formattedStartTime,
            endTime: formattedEndTime,
            hours: hours
          });
        }
      });
    });
  });
  return labour;
}

function extractMaterials(sections) {
  const materials = [];
  sections?.forEach(section => {
    section.costCenters?.forEach(cc => {
      cc.materials?.forEach(material => {
        if (material.Quantity && material.Quantity > 0) {
          materials.push({
            name: material.Name || material.Description || 'Unknown',
            quantity: material.Quantity,
            unit: material.Unit || 'ea',
            unitPrice: material.UnitPrice || 0,
            total: (material.Quantity * (material.UnitPrice || 0)).toFixed(2)
          });
        }
      });
    });
  });
  return materials;
}

function extractSingleWorkSummary(sections) {
  const notes = [];
  sections?.forEach(section => {
    section.costCenters?.forEach(cc => {
      cc.schedules?.forEach(schedule => {
        if (schedule.Notes && schedule.Notes.trim()) {
          notes.push(schedule.Notes.trim());
        }
      });
    });
  });
  
  const notesText = notes.join(' ').trim();
  if (notesText.length === 0) {
    return null; // Return null if no notes to prevent duplication
  }
  
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
    
    // Fetch customer details
    let customerDetails = null;
    if (job.Customer?.ID) {
      try {
        await delay(500); // Rate limiting
        customerDetails = await fetchWithRetry(`/companies/${companyId}/customers/${job.Customer.ID}`);
      } catch (error) {
        logger.warn(`Could not fetch customer details: ${error.message}`);
      }
    }
    
    // Fetch job sections (labour, materials, etc.)
    await delay(500);
    const sectionsUrl = `/companies/${companyId}/jobs/${jobId}/sections`;
    const sections = await fetchWithRetry(sectionsUrl);
    
    // Extract engineers
    const engineers = extractEngineers(sections);
    const engineerId = sections
      ?.flatMap(s => s.costCenters || [])
      .flatMap(cc => cc.schedules || [])
      .find(s => s.Staff?.ID)?.Staff.ID;
    
    // Build job card data
    const jobCardData = {
      job: {
        id: job.ID,
        jobNumber: job.JobNumber || job.ID.toString(),
        orderNo: job.OrderNo || null,
        description: job.Description || '',
        status: job.Status?.Name || '',
        priority: job.Priority?.Name || '',
        workOrderType: job.WorkOrderType?.Name || '',
        problemType: job.ProblemType?.Name || '',
        floorLevel: job.FloorLevel || '',
        locationDetails: job.LocationDetails || '',
        acceptSLA: job.AcceptSLA ? new Date(job.AcceptSLA).toLocaleString('en-GB') : '',
        responseSLA: job.ResponseSLA || '',
        fixSLA: job.FixSLA || '',
        nte: job.NTE || null
      },
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
      engineers: [`Dacha SSI Engineer (${engineerId || 'N/A'})`],
      labour: extractValidLabour(sections),
      materials: extractMaterials(sections),
      workSummary: extractSingleWorkSummary(sections),
      sections: sections
    };
    
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
