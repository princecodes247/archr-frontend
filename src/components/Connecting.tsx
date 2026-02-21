import React from 'react';
import './Connecting.css';

const Connecting: React.FC = () => {
    return (
        <div className="connecting-page">
            <div className="connecting-content">
                <div className="connecting-logo">
                    <h1 className="connecting-title">ARCHR</h1>
                    <div className="connecting-subtitle">Super Simple Archery</div>
                </div>

                <div className="target-loader">
                    <div className="target-ring target-ring-outer" />
                    <div className="target-ring target-ring-inner" />
                    <div className="target-center" />
                </div>

                <div className="connecting-status">
                    Connecting to Server
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                </div>
            </div>
        </div>
    );
};

export default Connecting;
