import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Package, Scan, Plus, Search, AlertTriangle, ArrowLeft, Save } from 'lucide-react';
import './App.css';

const API_BASE = 'https://peterson-backend.mattssmallenginerep.workers.dev';

function App() {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '', sku: '', upc: '', price: '', quantity: 1, reorder_point: 2, description: '', image_url: ''
  });

  useEffect(() => {
    fetchParts();
  }, []);

  const fetchParts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/parts`);
      setParts(res.data);
      setLoading(false);
    } catch (e) {
      console.error('Fetch error:', e);
      setLoading(false);
    }
  };

  const startScanner = () => {
    setShowScanner(true);
    setTimeout(() => {
      const scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });
      scanner.render(async (decodedText) => {
        scanner.clear();
        setShowScanner(false);
        setFormData(prev => ({ ...prev, upc: decodedText, sku: decodedText }));
        setShowAddModal(true);

        // Auto-Identify Lookup
        try {
          const res = await axios.get(`${API_BASE}/api/lookup?upc=${decodedText}`);
          if (res.data.success) {
            setFormData(prev => ({ 
              ...prev, 
              name: res.data.name, 
              description: res.data.description 
            }));
          }
        } catch (e) {
          console.error('Lookup failed:', e);
        }
      }, (error) => {
        // console.warn(error);
      });
    }, 100);
  };

  const [uploading, setUploading] = useState(false);

  const handlePhotoCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      // Binary upload to R2
      const res = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: file
      });
      const data = await res.json();
      if (data.url) {
        setFormData({ ...formData, image_url: data.url });
      }
    } catch (e) {
      alert('Photo upload failed: ' + e.message);
    }
    setUploading(false);
  };

  const handleAdjustQty = async (part, delta) => {
    const newQty = Math.max(0, part.quantity + delta);
    try {
      await axios.post(`${API_BASE}/api/parts`, {
        ...part,
        quantity: newQty
      });
      fetchParts();
    } catch (e) {
      alert('Adjustment failed: ' + e.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this part?')) return;
    try {
      await axios.delete(`${API_BASE}/api/parts/${id}`);
      fetchParts();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  };

  const handleEdit = (part) => {
    setFormData(part);
    setShowAddModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_BASE}/api/parts`, {
        ...formData,
        price: parseFloat(formData.price),
        quantity: parseInt(formData.quantity),
        reorder_point: parseInt(formData.reorder_point)
      });
      setShowAddModal(false);
      fetchParts();
      setFormData({ name: '', sku: '', upc: '', price: '', quantity: 1, reorder_point: 2, description: '', image_url: '' });
    } catch (e) {
      console.error('Save error details:', e);
      const msg = e.response?.data?.error || e.message;
      alert('Error saving part: ' + msg);
    }
  };

  return (
    <div className="app-container">
      <header>
        <div onClick={() => window.location.reload()} style={{ cursor: 'pointer' }}>
          <h1>Parts Manager</h1>
          <span className="badge">LIVE SYNC</span>
        </div>
        <Package color="white" size={24} />
      </header>

      {/* Stats Summary */}
      <div className="card" style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
        <div>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.8rem' }}>Items</p>
          <p style={{ margin: '5px 0 0', fontWeight: 'bold' }}>{parts.length}</p>
        </div>
        <div style={{ borderLeft: '1px solid #333', borderRight: '1px solid #333', padding: '0 20px' }}>
          <p style={{ margin: 0, color: 'var(--accent)', fontSize: '0.8rem' }}>Low Stock</p>
          <p style={{ margin: '5px 0 0', fontWeight: 'bold' }}>
            {parts.filter(p => p.quantity <= p.reorder_point).length}
          </p>
        </div>
        <div>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.8rem' }}>Value</p>
          <p style={{ margin: '5px 0 0', fontWeight: 'bold' }}>
            ${parts.reduce((sum, p) => sum + (p.price * p.quantity), 0).toFixed(0)}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '30px' }}>
        <button className="btn btn-primary" onClick={startScanner}>
          <Scan size={20} /> Scan UPC
        </button>
        <button className="btn btn-secondary" onClick={() => setShowAddModal(true)}>
          <Plus size={20} /> Add Part
        </button>
      </div>

      {/* Inventory List */}
      <div className="part-list">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Inventory</h2>
          <button className="btn" style={{ width: 'auto', background: 'transparent', color: 'var(--muted)', fontSize: '0.8rem' }} onClick={fetchParts}>Refresh</button>
        </div>
        
        {loading ? (
          <p>Loading...</p>
        ) : parts.length === 0 ? (
          <p style={{ color: 'var(--muted)', textAlign: 'center' }}>No parts in inventory yet.</p>
        ) : (
          parts.map(part => (
            <div key={part.id} className="part-item" style={{ padding: '15px' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1 }} onClick={() => handleEdit(part)}>
                {part.image_url ? (
                  <img src={part.image_url} style={{ width: '50px', height: '50px', borderRadius: '4px', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '50px', height: '50px', background: '#333', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Package size={20} color="#666" />
                  </div>
                )}
                <div className="part-info" style={{ flex: 1 }}>
                  <h3 style={{ fontSize: '1.1rem' }}>{part.name}</h3>
                  <p style={{ margin: '2px 0' }}>SKU: {part.sku}</p>
                  <p style={{ fontWeight: 'bold', color: '#fff' }}>${part.price.toFixed(2)}</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#000', padding: '5px', borderRadius: '8px' }}>
                  <button className="btn" style={{ width: '30px', height: '30px', padding: 0 }} onClick={() => handleAdjustQty(part, -1)}>-</button>
                  <span className={`stock-num ${part.quantity <= part.reorder_point ? 'stock-low' : ''}`} style={{ minWidth: '20px', textAlign: 'center' }}>
                    {part.quantity}
                  </span>
                  <button className="btn" style={{ width: '30px', height: '30px', padding: 0 }} onClick={() => handleAdjustQty(part, 1)}>+</button>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDelete(part.id); }}
                  style={{ background: 'transparent', border: 'none', color: '#555', padding: '5px' }}
                >
                  <Plus style={{ transform: 'rotate(45deg)' }} size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Scanner Overlay */}
      {showScanner && (
        <div className="scanner-container">
          <div className="scanner-overlay">
            <button className="btn btn-secondary" onClick={() => setShowScanner(false)} style={{ width: 'auto', marginBottom: '10px' }}>
              <ArrowLeft size={18} /> Cancel
            </button>
            <p>Point camera at the barcode</p>
          </div>
          <div id="reader"></div>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Add New Part</h2>
            <form onSubmit={handleSave}>
              {/* Photo Upload Section */}
              <div className="form-group" style={{ textAlign: 'center' }}>
                {formData.image_url ? (
                  <div style={{ position: 'relative' }}>
                    <img src={formData.image_url} style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: '8px' }} />
                    <button type="button" onClick={() => setFormData({...formData, image_url: ''})} style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.5)', border: 'none', color: 'white', borderRadius: '50%', width: '30px', height: '30px' }}>&times;</button>
                  </div>
                ) : (
                  <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                    <input type="file" accept="image/*" capture="environment" hidden onChange={handlePhotoCapture} />
                    {uploading ? 'Uploading...' : <><Scan size={18} /> Take Photo</>}
                  </label>
                )}
              </div>

              <div className="form-group">
                <label>Part Name</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Spark Plug RJ19LM" />
              </div>
              <div className="form-group">
                <label>SKU / UPC</label>
                <input required value={formData.sku} onChange={e => setFormData({...formData, sku: e.target.value})} placeholder="Scan or type..." />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label>Price ($)</label>
                  <input type="number" step="0.01" required value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Qty</label>
                  <input type="number" required value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '20px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary"><Save size={18} /> Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
