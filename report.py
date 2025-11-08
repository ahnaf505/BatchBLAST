import os
import csv
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import random
from collections import defaultdict
from datetime import datetime
from CONFIG import *
import textwrap
import pandas as pd
from typing import List, Dict, Any


def is_anomaly(title, non_anomaly_keywords):
    """Check if a result is anomalous based on absence of non-anomaly keywords"""
    if not title:
        return True  # Empty title is considered anomalous
    title_lower = title.lower()
    return not any(keyword.lower() in title_lower for keyword in non_anomaly_keywords)

def extract_species_group(title):
    """Extract species group from title - improved version"""
    if not title:
        return "Unknown"
    
    # Try to extract genus and species (first 2 meaningful words)
    words = title.split()
    if len(words) >= 2:
        # Look for the genus (first capitalized word typically)
        for i, word in enumerate(words):
            if word and word[0].isupper() and len(word) > 1:
                # Try to get genus and next word for species
                if i + 1 < len(words):
                    # Clean the species name (remove commas, etc.)
                    species_word = words[i + 1].rstrip(',.;')
                    return f"{word} {species_word}"
                return word
    return title[:50]  # Return first 50 chars if we can't extract properly

def group_anomalies(anomalies):
    """Group anomalies by species and return grouped data with counts"""
    grouped = defaultdict(list)
    
    for anomaly in anomalies:
        species_group = extract_species_group(anomaly.get('subject_title', ''))
        grouped[species_group].append(anomaly)
    
    grouped_data = []
    for species, records in grouped.items():
        grouped_data.append({
            'species_group': species,
            'count': len(records),
            'sample': records[0] if records else {},
            'all_records': records
        })
    
    return sorted(grouped_data, key=lambda x: x['count'], reverse=True)

def process_csv_file(csv_path):
    """Process a single CSV file and return data for PDF"""
    filename = os.path.basename(csv_path)
    data = {
        'filename': filename,
        'anomalies': [],
        'grouped_anomalies': [],
        'normal_samples': [],
        'total_records': 0,
        'anomaly_count': 0,
        'normal_count': 0
    }
    
    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            all_normal = []
            
            for row in reader:
                data['total_records'] += 1
                
                # Use subject_title instead of title for BLAST results
                title_to_check = row.get('subject_title', '')
                if is_anomaly(title_to_check, [load_config()[4]]):
                    data['anomalies'].append(row)
                    data['anomaly_count'] += 1
                else:
                    all_normal.append(row)
                    data['normal_count'] += 1
            
            data['grouped_anomalies'] = group_anomalies(data['anomalies'])
            
            # Take random sample of normal results
            sample_size = min(CONFIG['normal_sample_size'], len(all_normal))
            data['normal_samples'] = random.sample(all_normal, sample_size) if all_normal else []
            
    except Exception as e:
        print(f"Error processing {csv_path}: {str(e)}")
    
    return data

def truncate_text(text, max_length=80):
    """Truncate text to maximum length and add ellipsis if needed"""
    if not text:
        return ""
    text = str(text)
    return text[:max_length] + "..." if len(text) > max_length else text

def calculate_column_widths(headers, data, max_table_width=7.0*inch):
    """Calculate column widths that fit within page boundaries"""
    if not data:
        return [1.5 * inch] * len(headers)  # Default widths
    
    # Estimate character widths (approximate)
    char_width = 4.5  # Points per character approximation
    
    # Calculate max content length for each column
    max_lengths = []
    for i, header in enumerate(headers):
        header_len = len(str(header))
        content_len = max([len(str(row[i])) for row in data]) if data else 0
        max_lengths.append(max(header_len, content_len))
    
    # Calculate total width needed
    total_chars = sum(max_lengths)
    
    if total_chars == 0:
        return [max_table_width / len(headers)] * len(headers)
    
    # Scale columns to fit available width
    scale_factor = max_table_width / (total_chars * char_width)
    col_widths = [max(length * char_width * scale_factor, 0.8 * inch) for length in max_lengths]
    
    # Ensure we don't exceed max width
    total_width = sum(col_widths)
    if total_width > max_table_width:
        scale = max_table_width / total_width
        col_widths = [w * scale for w in col_widths]
    
    return col_widths

def create_styled_table(headers, data, style_type='normal', max_table_width=7.0*inch):
    """Create a styled table with consistent formatting that fits within page"""
    if not data:
        return None
    
    # Truncate long text in data to prevent overflow
    truncated_data = []
    for row in data:
        truncated_row = [truncate_text(cell) for cell in row]
        truncated_data.append(truncated_row)
    
    table_data = [headers] + truncated_data
    
    # Calculate column widths that fit the page
    col_widths = calculate_column_widths(headers, data, max_table_width)
    
    # Define color schemes for different table types
    color_schemes = {
        'summary': {
            'header_bg': colors.HexColor('#2C3E50'),
            'header_text': colors.white,
            'row_colors': [colors.white, colors.HexColor('#F8F9FA')]
        },
        'anomaly': {
            'header_bg': colors.HexColor('#E74C3C'),
            'header_text': colors.white,
            'row_colors': [colors.white, colors.HexColor('#FDEDEC')]
        },
        'normal': {
            'header_bg': colors.HexColor('#27AE60'),
            'header_text': colors.white,
            'row_colors': [colors.white, colors.HexColor('#F0F8F0')]
        },
        'grouped': {
            'header_bg': colors.HexColor('#8E44AD'),
            'header_text': colors.white,
            'row_colors': [colors.white, colors.HexColor('#F4ECF7')]
        }
    }
    
    scheme = color_schemes.get(style_type, color_schemes['normal'])
    
    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    
    style = TableStyle([
        # Header styling
        ('BACKGROUND', (0, 0), (-1, 0), scheme['header_bg']),
        ('TEXTCOLOR', (0, 0), (-1, 0), scheme['header_text']),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        
        # Body styling
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 8),
        ('ALIGN', (0, 1), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        
        # Grid and spacing
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), scheme['row_colors']),
        ('PADDING', (0, 0), (-1, -1), 4),
        ('WORDWRAP', (0, 0), (-1, -1), True),  # Enable word wrap
    ])
    
    table.setStyle(style)
    return table

def create_detailed_section(title, records, max_rows=8, max_table_width=7.0*inch):
    """Create a detailed section with truncated data if needed"""
    if not records:
        return [Paragraph("No data available.", getSampleStyleSheet()['Normal'])]
    
    # Use first record for headers
    headers = list(records[0].keys())
    
    # Prepare table data (limit rows for display)
    display_records = records[:max_rows]
    table_data = []
    
    for record in display_records:
        row = []
        for header in headers:
            value = str(record.get(header, ''))
            # Truncate long values for display
            if len(value) > 150:
                value = value[:147] + '...'
            row.append(value)
        table_data.append(row)
    
    elements = []
    styles = getSampleStyleSheet()
    
    # Add record count info
    if len(records) > max_rows:
        elements.append(Paragraph(
            f"Showing {max_rows} of {len(records)} records", 
            styles['Italic']
        ))
        elements.append(Spacer(1, 5))
    
    table = create_styled_table(headers, table_data, 'normal', max_table_width)
    if table:
        elements.append(table)
    
    return elements

def create_pdf_report(all_data, folder_path):
    """Create PDF report from processed data"""
    folder_path = Path(folder_path)
    doc = SimpleDocTemplate(str(folder_path / "anomaly_output.pdf"), pagesize=A4)
    styles = getSampleStyleSheet()
    story = []
    
    # Custom styles
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        spaceAfter=20,
        alignment=1,
        textColor=colors.HexColor('#2C3E50')
    )
    
    section_style = ParagraphStyle(
        'SectionStyle',
        parent=styles['Heading2'],
        fontSize=14,
        spaceAfter=12,
        textColor=colors.HexColor('#34495E')
    )
    
    # Title and metadata
    story.append(Paragraph(load_config()[5]+" BLAST Anomaly Report", title_style))
    story.append(Paragraph(
        f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", 
        styles['Normal']
    ))
    story.append(Spacer(1, 20))
    
    # Overall statistics
    total_files = len(all_data)
    total_records = sum(d['total_records'] for d in all_data)
    total_anomalies = sum(d['anomaly_count'] for d in all_data)
    
    # Avoid division by zero
    anomaly_percentage = (total_anomalies / total_records * 100) if total_records > 0 else 0
    
    stats_data = [
        ["Total Sequence Analyzed", str(total_files)],
        ["Total Records", f"{total_records:,}"],
        ["Total Anomalies", f"{total_anomalies:,}"],
        ["Anomaly Rate", f"{anomaly_percentage:.1f}%"]
    ]
    
    stats_table = create_styled_table(["Metric", "Value"], stats_data, 'summary')
    story.append(Paragraph("Overall Statistics", section_style))
    story.append(stats_table)
    story.append(Spacer(1, 25))
    
    # Configuration info in a more compact format
    folder_label = folder_path.name or folder_path.as_posix()
    config_text = f"""
    <b>Analysis Configuration:</b><br/>
    Non-anomaly keywords: {', '.join([load_config()[4]])}<br/>
    Normal sample size: {CONFIG['normal_sample_size']}<br/>
    BatchBLAST ID: {folder_label}
    """
    story.append(Paragraph(config_text, styles['Normal']))
    story.append(Spacer(1, 20))
    
    # File-by-file analysis
    story.append(Paragraph("Detailed File Analysis", section_style))
    
    file_summary_data = [["Input Sequence Name", "Total", "Normal", "Anomalies", "Anomaly %"]]
    for data in all_data:
        anomaly_pct = (data['anomaly_count'] / data['total_records'] * 100) if data['total_records'] > 0 else 0
        file_summary_data.append([
            truncate_text(data['filename'][:-3], 40),
            str(data['total_records']),
            str(data['normal_count']),
            str(data['anomaly_count']),
            f"{anomaly_pct:.1f}%"
        ])
    
    file_table = create_styled_table(
        file_summary_data[0], 
        file_summary_data[1:], 
        'summary'
    )
    story.append(file_table)
    story.append(Spacer(1, 30))
    story.append(PageBreak()) 
    
    # Detailed results for each file
    for data_idx, data in enumerate(all_data):
        if data_idx > 0:
            story.append(PageBreak())
        
        # File header with statistics
        story.append(Paragraph(f"Analysis: {data['filename'][:-3]}", section_style))
        
        anomaly_pct = (data['anomaly_count'] / data['total_records'] * 100) if data['total_records'] > 0 else 0
        file_stats = [
            ["Total Records", str(data['total_records'])],
            ["Normal Results", str(data['normal_count'])],
            ["Anomalous Results", str(data['anomaly_count'])],
            ["Anomaly Percentage", f"{anomaly_pct:.1f}%"]
        ]

        
        file_stats_table = create_styled_table(["Metric", "Value"], file_stats, 'summary')
        story.append(file_stats_table)
        story.append(Spacer(1, 20))
        
        # Anomalies section
        if data['grouped_anomalies']:
            story.append(Paragraph("Anomaly Groups", styles['Heading3']))
            
            # Group summary
            group_data = [["Species Group", "Count", "Percentage"]]
            for group in data['grouped_anomalies']:
                group_pct = (group['count'] / data['anomaly_count'] * 100)
                group_data.append([
                    truncate_text(group['species_group'], 40),
                    str(group['count']),
                    f"{group_pct:.1f}%"
                ])
            
            group_table = create_styled_table(group_data[0], group_data[1:], 'anomaly')
            story.append(group_table)
            story.append(Spacer(1, 15))
            
            # Sample anomalies from each group
            story.append(Paragraph("Sample Anomalies", styles['Heading4']))
            
            # Create simplified sample table for anomalies
            if data['grouped_anomalies']:
                sample_headers = ["Species Group", "Count", "Sample Title", "Accession"]
                sample_data = []
                for group in data['grouped_anomalies'][:6]:  # Limit to 6 groups
                    sample = group['sample']
                    sample_data.append([
                        truncate_text(group['species_group'], 25),
                        str(group['count']),
                        truncate_text(sample.get('subject_title', ''), 60),
                        truncate_text(sample.get('subject_accession', ''), 15)
                    ])
                
                sample_table = create_styled_table(sample_headers, sample_data, 'anomaly')
                if sample_table:
                    story.append(sample_table)
            
        else:
            story.append(Paragraph("No anomalies detected in this file.", styles['Normal']))
        
        story.append(Spacer(1, 20))
        
        # Normal samples section
        if data['normal_samples']:
            story.append(Paragraph("Normal Results Sample", styles['Heading3']))
            
            # Create simplified normal samples table
            normal_headers = ["Title", "Accession", "E-value"]
            normal_data = []
            for sample in data['normal_samples'][:8]:  # Limit to 8 samples
                normal_data.append([
                    truncate_text(sample.get('subject_title', ''), 80),
                    truncate_text(sample.get('subject_accession', ''), 15),
                    truncate_text(sample.get('evalue', ''), 15)
                ])
            
            normal_table = create_styled_table(normal_headers, normal_data, 'normal')
            if normal_table:
                story.append(normal_table)
    
    # Add overall anomaly patterns
    if len(all_data) > 1:
        story.append(PageBreak())
        story.append(Paragraph("Cross-File Anomaly Patterns", section_style))
        
        # Aggregate anomaly patterns across all files
        cross_anomalies = defaultdict(int)
        for data in all_data:
            for group in data['grouped_anomalies']:
                cross_anomalies[group['species_group']] += group['count']
        
        if cross_anomalies:
            cross_data = [["Species Group", "Total Occurrences"]]
            for species, count in sorted(cross_anomalies.items(), key=lambda x: x[1], reverse=True)[:10]:  # Top 10 only
                cross_data.append([truncate_text(species, 50), str(count)])
            
            cross_table = create_styled_table(cross_data[0], cross_data[1:], 'grouped')
            story.append(cross_table)
        else:
            story.append(Paragraph("No cross-file anomaly patterns detected.", styles['Normal']))
    
    doc.build(story)

def analyze_anomaly_patterns(all_data):
    """Analyze and report patterns in anomalies across all files"""
    anomaly_species = defaultdict(int)
    
    for data in all_data:
        for group in data['grouped_anomalies']:
            anomaly_species[group['species_group']] += group['count']
    
    return dict(anomaly_species)

def generate_report(folder_path):
    results_folder = Path(folder_path)
    if not results_folder.exists():
        return 1

    csv_files = sorted(results_folder.glob('*.csv'))

    if not csv_files:
        return 1

    all_data = []

    for csv_file in csv_files:
        data = process_csv_file(str(csv_file))
        all_data.append(data)

    create_pdf_report(all_data, results_folder)

class BLASTReportGenerator:
    def __init__(self, output_filename: str = "BLAST_Report.pdf"):
        self.output_filename = output_filename
        self.styles = getSampleStyleSheet()
        self._setup_custom_styles()
        
    def _setup_custom_styles(self):
        """Setup custom paragraph styles for better formatting."""
        self.styles.add(ParagraphStyle(
            name='CustomTitle',
            parent=self.styles['Heading1'],
            fontSize=16,
            spaceAfter=30,
            alignment=1  # Center aligned
        ))
        self.styles.add(ParagraphStyle(
            name='CustomHeading',
            parent=self.styles['Heading2'],
            fontSize=12,
            spaceAfter=12,
            spaceBefore=12
        ))
        self.styles.add(ParagraphStyle(
            name='CustomBody',
            parent=self.styles['BodyText'],
            fontSize=9,
            spaceAfter=6
        ))

    def read_csv_files(self, folder_path: Path) -> Dict[str, pd.DataFrame]:
        try:
            folder = Path(folder_path)
            csv_files = sorted(folder.glob("*.csv"))

            if not csv_files:
                raise FileNotFoundError(f"No CSV files found in {folder_path}")


            dataframes = {}
            for csv_file in csv_files:
                filename = csv_file.name
                filename_without_ext = csv_file.stem

                df = pd.read_csv(csv_file)
                # Select only the required columns
                required_columns = [
                    'query_title',     # <-- include query info
                    'subject_title',
                    'taxid',
                    'sci_name',        # <-- include species name
                    'identity_pct',
                    'bit_score',
                    'evalue'
                ]
                available_columns = [col for col in required_columns if col in df.columns]
                
                if not available_columns:
                    continue
                    
                df_filtered = df[available_columns].copy()
                dataframes[filename_without_ext] = df_filtered
            
            return dataframes
            
        except Exception as e:
            raise

    def generate_summary_stats(self, dataframes: Dict[str, pd.DataFrame]) -> Dict[str, Any]:
        total_hits = 0
        all_files_data = []
        all_species = []
        all_queries = []
    
        for filename, df in dataframes.items():
            # Accumulate global lists for cross-file aggregation
            if 'sci_name' in df.columns:
                all_species.extend(df['sci_name'].dropna().tolist())
            if 'query_title' in df.columns:
                all_queries.extend(df['query_title'].dropna().tolist())
    
            file_stats = {
                'filename': filename,
                'hits': len(df),
                'avg_identity': df['identity_pct'].mean() if 'identity_pct' in df.columns else 0,
                'unique_taxids': df['taxid'].nunique() if 'taxid' in df.columns else 0,
                'data': df  # Keep dataframe reference for deeper use later
            }
            all_files_data.append(file_stats)
            total_hits += len(df)
    
        return {
            'total_hits': total_hits,
            'unique_files': len(dataframes),
            'file_stats': all_files_data,
            'all_species': all_species,
            'all_queries': all_queries
        }


    def wrap_text(self, text: str, width: int = 50) -> str:
        """Wrap long text to multiple lines to prevent column overflow."""
        if not isinstance(text, str):
            text = str(text)
        return '\n'.join(textwrap.wrap(text, width=width))

    def create_summary_section(self, stats: Dict[str, Any]) -> List[Any]:

        """Create the summary section of the report dynamically using real data."""
        elements = []
    
        elements.append(Paragraph(load_config()[5]+" BLAST Full Report", self.styles['CustomTitle']))
        elements.append(Spacer(1, 0.3 * inch))
    
        elements.append(Paragraph("<b>Summary Statistics</b>", self.styles['CustomHeading']))
        elements.append(Spacer(1, 0.1 * inch))
    
        # Dynamically compute overall metrics
        avg_identity = (
            sum(f['avg_identity'] for f in stats['file_stats']) / len(stats['file_stats'])
            if stats['file_stats'] else 0
        )
        max_identity = max(
            (f['avg_identity'] for f in stats['file_stats'] if f['avg_identity'] is not None), default=0
        )
        min_identity = min(
            (f['avg_identity'] for f in stats['file_stats'] if f['avg_identity'] is not None), default=0
        )
    
        unique_queries = stats['unique_files']
        total_hits = stats['total_hits']
        unique_subjects = sum(f['unique_taxids'] for f in stats['file_stats'])
        unique_species = unique_subjects  # approximate until taxonomic grouping added
    
        summary_data = [
            ["Total Hits", f"{total_hits:,}"],
            ["Unique Queries", f"{unique_queries:,}"],
            ["Unique Subjects", f"{unique_subjects:,}"],
            ["Unique Species", f"{unique_species:,}"],
            ["Average Identity %", f"{avg_identity:.2f}"],
            ["Maximum Identity %", f"{max_identity:.2f}"],
            ["Minimum Identity %", f"{min_identity:.2f}"],
        ]
    
        summary_table = Table(summary_data, colWidths=[2.8 * inch, 1.5 * inch])
        summary_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), colors.HexColor("#DCE6F1")),
            ('BACKGROUND', (1, 0), (1, -1), colors.HexColor("#FFF2CC")),
            ('BOX', (0, 0), (-1, -1), 1, colors.black),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        elements.append(summary_table)
        elements.append(Spacer(1, 0.3 * inch))
    
        # === Source Files ===
        elements.append(Paragraph("<b>Source Files</b>", self.styles['CustomHeading']))
        for file_stat in stats.get('file_stats', []):
            elements.append(Paragraph(
                f"• {file_stat['filename']} ({file_stat['hits']} hits, "
                f"{file_stat['unique_taxids']} unique taxids)", 
                self.styles['CustomBody']
            ))
        elements.append(Spacer(1, 0.3 * inch))

        # === Top Species by Hit Count ===
        elements.append(Paragraph("<b>Top Species by Hit Count</b>", self.styles['CustomHeading']))
        
        species_counts = pd.Series(stats['all_species']).value_counts().to_dict()
        top_species = sorted(species_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        top_species_data = [["Species", "Hit Count"]] + [[s, str(c)] for s, c in top_species]
        
        species_table = Table(top_species_data, colWidths=[3 * inch, 1.2 * inch])
        species_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#B6D7A8")),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('BOX', (0, 0), (-1, -1), 1, colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
        ]))
        elements.append(species_table)
        elements.append(Spacer(1, 0.3 * inch))
        
        # === Top Queries by Hit Count ===
        elements.append(Paragraph("<b>Top Queries by Hit Count</b>", self.styles['CustomHeading']))
        
        query_counts = pd.Series(stats['all_queries']).value_counts().to_dict()
        top_queries = sorted(query_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        top_queries_data = [["Query Title", "Hit Count"]] + [[q, str(c)] for q, c in top_queries]
        
        queries_table = Table(top_queries_data, colWidths=[3 * inch, 1.2 * inch])
        queries_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#F4CCCC")),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('BOX', (0, 0), (-1, -1), 1, colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
        ]))
        elements.append(queries_table)
        elements.append(Spacer(1, 0.2 * inch))
    
        return elements


    def create_file_data_tables(self, dataframes: Dict[str, pd.DataFrame]) -> List[Any]:
        """Create individual tables for each CSV file with proper formatting."""
        elements = []
        
        for filename, df in dataframes.items():
            # Add section header for this file
            elements.append(Paragraph(f"Sequence: {filename}", self.styles['CustomHeading']))
            elements.append(Spacer(1, 0.1*inch))
            
            # Prepare table data with wrapped text
            table_data = [["Subject Title", "TaxID", "Identity %", "Bit Score", "E-value"]]
            
            for _, row in df.iterrows():
                wrapped_subject = self.wrap_text(row['subject_title'], 40) if 'subject_title' in row else "N/A"
                taxid = str(row['taxid']) if 'taxid' in row else "N/A"
                identity = f"{row['identity_pct']:.1f}" if 'identity_pct' in row else "N/A"
                bit_score = f"{row['bit_score']:.4f}" if 'bit_score' in row else "N/A"
                evalue = f"{row['evalue']:.6f}" if 'evalue' in row else "N/A"
                
                table_data.append([wrapped_subject, taxid, identity, bit_score, evalue])
            
            # Create table with optimized column widths
            table = Table(
                table_data, 
                colWidths=[3.5*inch, 0.8*inch, 0.8*inch, 1*inch, 1*inch],
                repeatRows=1  # Repeat header on each page
            )
            
            # Apply table styling
            table.setStyle(TableStyle([
                # Header style
                ('BACKGROUND', (0, 0), (-1, 0), colors.darkblue),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 9),
                
                # Data row styles
                ('ALIGN', (0, 1), (-1, -1), 'LEFT'),
                ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
                ('FONTSIZE', (0, 1), (-1, -1), 8),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
                ('BACKGROUND', (0, 1), (-1, -1), colors.white),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.lightgrey]),
                
                # Specific column alignments
                ('ALIGN', (1, 1), (1, -1), 'CENTER'),  # TaxID centered
                ('ALIGN', (2, 1), (3, -1), 'CENTER'),  # Numeric columns centered
            ]))
            
            elements.append(table)
            elements.append(Paragraph(f"Total records in {filename}: {len(df):,}", self.styles['CustomBody']))
            elements.append(Spacer(1, 0.3*inch))
            
            # Add page break if this isn't the last file
            if filename != list(dataframes.keys())[-1]:
                elements.append(PageBreak())
        
        return elements

    def generate_report(self, folder_path: Path) -> str:
        try:
            # Read and process data
            dataframes = self.read_csv_files(folder_path)

            if not dataframes:
                raise ValueError("No valid CSV files with required columns found")

            stats = self.generate_summary_stats(dataframes)

            # Set up PDF document
            output_path = Path(folder_path) / self.output_filename
            doc = SimpleDocTemplate(
                str(output_path),
                pagesize=A4,
                topMargin=0.5*inch,
                bottomMargin=0.5*inch
            )
            
            # Build report elements
            story = []
            
            # Add summary section
            story.extend(self.create_summary_section(stats))
            story.append(PageBreak())
            
            # Add individual file data tables
            story.extend(self.create_file_data_tables(dataframes))
            
            # Generate PDF
            doc.build(story)
            
            return str(output_path)

        except Exception as e:
            raise

def generate_blast_full_report(folder_path: Path, output_filename: str = "BLAST_Full_Report.pdf") -> str:
    folder = Path(folder_path)
    if not folder.exists():
        raise ValueError(f"Folder path does not exist: {folder_path}")

    generator = BLASTReportGenerator(output_filename)
    return generator.generate_report(folder)

