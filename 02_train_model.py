import pandas as pd
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report

# Load dataset
df = pd.read_csv('distraction_dataset.csv')

X = df.drop('label', axis=1)
y = df['label']

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

# Enhanced Model Parameters for higher capacity & precision
model = xgb.XGBClassifier(
    n_estimators=150,     # Increased trees from 50 to 150
    max_depth=5,          # Deepened decision trees
    learning_rate=0.05,   # Smoother convergence
    subsample=0.8,
    colsample_bytree=0.8,
    eval_metric='logloss'
)

model.fit(X_train, y_train)

# Validation
preds = model.predict(X_test)
acc = accuracy_score(y_test, preds)

print("\n=== MODEL TRAINING RESULTS ===")
print(f"Overall Accuracy: {acc * 100:.2f}%\n")
print(classification_report(y_test, preds, target_names=["Focused (0)", "Distracted (1)"]))

# Save model
model.save_model('distraction_model.json')
print("Model saved successfully as distraction_model.json")